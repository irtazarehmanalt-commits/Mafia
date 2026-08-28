'use client';

import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type AnnouncementPayload,
  type ChatChannel,
  type ChatMessage,
  type GameEvent,
  type GameSettingsPatch,
  type NightActionType,
  type PrivateResultPayload,
  type RoomStateForClient,
  type VoteTarget,
} from '@mafia/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { sound } from '@/lib/sound';
import { clearSession, loadSession, type StoredSession } from '@/lib/session';
import { emitWithAck, getSocket, SocketError, type GameSocket } from '@/lib/socket';

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'kicked'
  | 'closed'
  | 'error';

export interface Toast {
  id: string;
  tone: 'info' | 'danger' | 'success';
  message: string;
}

interface GameContextValue {
  state: RoomStateForClient | null;
  status: ConnectionStatus;
  fatalError: string | null;
  /** Estimated (serverClock - localClock) in ms, from RTT sampling. */
  clockOffset: number;
  toasts: Toast[];
  announcement: AnnouncementPayload | null;
  lastInvestigation: PrivateResultPayload | null;

  dismissToast(id: string): void;
  dismissAnnouncement(): void;

  startGame(): Promise<void>;
  setReady(ready: boolean): Promise<void>;
  updateSettings(settings: GameSettingsPatch): Promise<void>;
  kickPlayer(playerId: string): Promise<void>;
  transferHost(playerId: string): Promise<void>;
  cancelRoom(): Promise<void>;
  endGameEarly(): Promise<void>;
  submitNightAction(action: NightActionType, targetId: string | null): Promise<void>;
  castVote(targetId: VoteTarget | null): Promise<void>;
  sendChat(channel: ChatChannel, body: string): Promise<void>;
  voteRematch(vote: boolean): Promise<void>;
  leaveRoom(): Promise<void>;
}

const GameContext = createContext<GameContextValue | null>(null);

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used inside <GameProvider>');
  return ctx;
}

/** Convenience accessor for screens that only render once state exists. */
export function useRoomState(): RoomStateForClient {
  const { state } = useGame();
  if (!state) throw new Error('Room state is not loaded yet');
  return state;
}

interface GameProviderProps {
  roomCode: string;
  session: StoredSession;
  children: ReactNode;
}

export function GameProvider({ roomCode, session, children }: GameProviderProps) {
  const [state, setState] = useState<RoomStateForClient | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [announcement, setAnnouncement] = useState<AnnouncementPayload | null>(null);
  const [lastInvestigation, setLastInvestigation] = useState<PrivateResultPayload | null>(null);

  const socketRef = useRef<GameSocket | null>(null);
  /** Best (lowest) round-trip sample seen so far, for clock estimation. */
  const bestRttRef = useRef<number>(Number.POSITIVE_INFINITY);
  const previousPhaseRef = useRef<string | null>(null);

  const pushToast = useCallback((tone: Toast['tone'], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((current) => [...current.slice(-3), { id, tone, message }]);
    // Toasts are transient; anything important is also in the event log.
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 5200);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    /**
     * Runs on first connect *and* on every reconnect. Rejoining with the
     * stored token is what restores the player's identity, role and place in
     * the round — the server treats it as the same seat, never a new one.
     */
    const rejoin = async () => {
      try {
        const fresh = loadSession(roomCode) ?? session;
        const roomState = await emitWithAck<typeof CLIENT_EVENTS.ROOM_JOIN, RoomStateForClient>(
          socket,
          CLIENT_EVENTS.ROOM_JOIN,
          { roomCode, token: fresh.token },
        );
        setState(roomState);
        setStatus('connected');
        setFatalError(null);
      } catch (err) {
        const message = err instanceof SocketError ? err.message : 'Could not join the room.';
        if (err instanceof SocketError && err.payload.code === 'NOT_AUTHENTICATED') {
          clearSession(roomCode);
        }
        setFatalError(message);
        setStatus('error');
      }
    };

    const onConnect = () => {
      setStatus('connecting');
      void rejoin();
    };

    const onDisconnect = (reason: string) => {
      // An explicit client-side disconnect is not an error state.
      if (reason === 'io client disconnect') return;
      setStatus('reconnecting');
    };

    const onConnectError = () => {
      setStatus('reconnecting');
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);

    // --- Game events -------------------------------------------------------

    socket.on(SERVER_EVENTS.ROOM_STATE, (next) => {
      setState(next);
      setStatus('connected');
    });

    socket.on(SERVER_EVENTS.GAME_PHASE_CHANGED, (payload) => {
      // Sound cues fire from the authoritative phase change, not from render.
      if (payload.phase === 'NIGHT') sound().play('night');
      if (payload.phase === 'DAY_ANNOUNCEMENT') sound().play('morning');
      if (payload.phase === 'ROLE_REVEAL') sound().play('gameStart');
      setAnnouncement(null);
    });

    socket.on(SERVER_EVENTS.GAME_PLAYER_DIED, (payload) => {
      sound().play(payload.cause === 'VOTE' ? 'eliminate' : 'death');
      pushToast(
        'danger',
        payload.revealedRole
          ? `${payload.playerName} is dead — they were ${payload.revealedRole.toLowerCase()}.`
          : `${payload.playerName} is dead.`,
      );
    });

    socket.on(SERVER_EVENTS.GAME_ANNOUNCEMENT, (payload) => {
      setAnnouncement(payload);
    });

    socket.on(SERVER_EVENTS.GAME_PRIVATE_RESULT, (payload) => {
      setLastInvestigation(payload);
      pushToast(
        payload.isMafia ? 'danger' : 'success',
        `${payload.targetName} is ${payload.isMafia ? 'MAFIA' : 'not Mafia'}.`,
      );
    });

    socket.on(SERVER_EVENTS.GAME_CHAT, (message: ChatMessage) => {
      setState((current) => {
        if (!current) return current;
        if (current.chat.some((m) => m.id === message.id)) return current;
        return { ...current, chat: [...current.chat, message].slice(-200) };
      });
    });

    socket.on(SERVER_EVENTS.GAME_EVENT, (event: GameEvent) => {
      setState((current) => {
        if (!current) return current;
        if (current.events.some((e) => e.id === event.id)) return current;
        return { ...current, events: [...current.events, event].slice(-120) };
      });
    });

    socket.on(SERVER_EVENTS.GAME_VOTE_UPDATED, (payload) => {
      setState((current) => (current ? { ...current, voteTallies: payload.tallies } : current));
    });

    socket.on(SERVER_EVENTS.GAME_OVER, ({ result }) => {
      setState((current) => (current ? { ...current, result } : current));
    });

    socket.on(SERVER_EVENTS.ROOM_PLAYER_JOINED, ({ player }) => {
      sound().play('join');
      pushToast('info', `${player.name} joined.`);
    });

    socket.on(SERVER_EVENTS.ROOM_KICKED, ({ reason }) => {
      clearSession(roomCode);
      setFatalError(reason);
      setStatus('kicked');
      socket.disconnect();
    });

    socket.on(SERVER_EVENTS.ROOM_CLOSED, ({ reason }) => {
      setFatalError(reason);
      setStatus('closed');
      socket.disconnect();
    });

    socket.on(SERVER_EVENTS.ERROR, (payload) => {
      pushToast('danger', payload.message);
    });

    if (!socket.connected) socket.connect();
    else void rejoin();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.removeAllListeners();
    };
    // `session` is only the bootstrap credential; re-running on its identity
    // would needlessly tear the connection down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, pushToast]);

  // -------------------------------------------------------------------------
  // Clock synchronisation
  // -------------------------------------------------------------------------

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || status !== 'connected') return;

    /**
     * Estimates the offset between this browser's clock and the server's.
     * Countdowns are then derived from server timestamps, so a player with a
     * badly-set system clock still sees the correct timer.
     */
    const sample = async () => {
      const sentAt = Date.now();
      try {
        const reply = await emitWithAck<typeof CLIENT_EVENTS.PING, { t: number; serverTime: number }>(
          socket,
          CLIENT_EVENTS.PING,
          { t: sentAt },
          4000,
        );
        const receivedAt = Date.now();
        const rtt = receivedAt - sentAt;
        // Only trust the tightest sample; a slow one skews the midpoint.
        if (rtt < bestRttRef.current) {
          bestRttRef.current = rtt;
          setClockOffset(reply.serverTime + rtt / 2 - receivedAt);
        }
      } catch {
        /* a missed ping is harmless — we keep the last good offset */
      }
    };

    void sample();
    const timer = setInterval(() => void sample(), 20_000);
    return () => clearInterval(timer);
  }, [status]);

  // Victory fanfare, fired once when the game actually ends.
  useEffect(() => {
    if (!state) return;
    if (previousPhaseRef.current !== 'GAME_OVER' && state.phase === 'GAME_OVER') {
      const won = state.result?.winner === state.you.team;
      sound().play(won ? 'victory' : 'defeat');
    }
    previousPhaseRef.current = state.phase;
  }, [state]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  /** Every action goes through here so errors surface as toasts uniformly. */
  const call = useCallback(
    async (event: string, payload: unknown) => {
      const socket = socketRef.current;
      if (!socket) throw new Error('Not connected');
      try {
        await emitWithAck(socket, event as never, payload);
      } catch (err) {
        if (err instanceof SocketError) pushToast('danger', err.message);
        throw err;
      }
    },
    [pushToast],
  );

  const value = useMemo<GameContextValue>(
    () => ({
      state,
      status,
      fatalError,
      clockOffset,
      toasts,
      announcement,
      lastInvestigation,
      dismissToast,
      dismissAnnouncement: () => setAnnouncement(null),

      startGame: () => call(CLIENT_EVENTS.GAME_START, {}),
      setReady: (ready) => call(CLIENT_EVENTS.ROOM_SET_READY, { ready }),
      updateSettings: (settings) => call(CLIENT_EVENTS.ROOM_UPDATE_SETTINGS, { settings }),
      kickPlayer: (playerId) => call(CLIENT_EVENTS.ROOM_KICK, { playerId }),
      transferHost: (playerId) => call(CLIENT_EVENTS.ROOM_TRANSFER_HOST, { playerId }),
      cancelRoom: () => call(CLIENT_EVENTS.ROOM_CANCEL, {}),
      endGameEarly: () => call(CLIENT_EVENTS.GAME_END_EARLY, {}),
      submitNightAction: (action, targetId) =>
        call(CLIENT_EVENTS.GAME_ACTION, { action, targetId }),
      castVote: async (targetId) => {
        sound().play('vote');
        await call(CLIENT_EVENTS.GAME_VOTE, { targetId });
      },
      sendChat: (channel, body) => call(CLIENT_EVENTS.GAME_CHAT, { channel, body }),
      voteRematch: (vote) => call(CLIENT_EVENTS.GAME_REMATCH, { vote }),
      leaveRoom: async () => {
        await call(CLIENT_EVENTS.ROOM_LEAVE, {});
        clearSession(roomCode);
      },
    }),
    [
      state,
      status,
      fatalError,
      clockOffset,
      toasts,
      announcement,
      lastInvestigation,
      dismissToast,
      call,
      roomCode,
    ],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
