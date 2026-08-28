import type { ErrorCode } from './errors';
import type { GameSettingsPatch } from './settings';
import type {
  ChatChannel,
  ChatMessage,
  GameEvent,
  GameResult,
  NightActionType,
  Phase,
  PublicPlayer,
  RoomStateForClient,
  VoteTarget,
} from './types';

// ---------------------------------------------------------------------------
// Event name constants — imported by both ends so a typo is a compile error.
// ---------------------------------------------------------------------------

export const CLIENT_EVENTS = {
  ROOM_JOIN: 'room:join',
  ROOM_LEAVE: 'room:leave',
  ROOM_UPDATE_SETTINGS: 'room:updateSettings',
  ROOM_KICK: 'room:kick',
  ROOM_TRANSFER_HOST: 'room:transferHost',
  ROOM_CANCEL: 'room:cancel',
  ROOM_SET_READY: 'room:setReady',
  GAME_START: 'game:start',
  GAME_ACTION: 'game:action',
  GAME_VOTE: 'game:vote',
  GAME_CHAT: 'game:chat',
  GAME_REMATCH: 'game:rematch',
  GAME_END_EARLY: 'game:endEarly',
  PING: 'ping:rtt',
} as const;

export const SERVER_EVENTS = {
  ROOM_STATE: 'room:state',
  ROOM_PLAYER_JOINED: 'room:playerJoined',
  ROOM_PLAYER_LEFT: 'room:playerLeft',
  ROOM_CLOSED: 'room:closed',
  ROOM_KICKED: 'room:kicked',
  GAME_STARTED: 'game:started',
  GAME_PHASE_CHANGED: 'game:phaseChanged',
  GAME_TIMER: 'game:timer',
  GAME_PLAYER_DIED: 'game:playerDied',
  GAME_VOTE_UPDATED: 'game:voteUpdated',
  GAME_ANNOUNCEMENT: 'game:announcement',
  GAME_PRIVATE_RESULT: 'game:privateResult',
  GAME_CHAT: 'game:chat',
  GAME_EVENT: 'game:event',
  GAME_OVER: 'game:over',
  GAME_RESET: 'game:reset',
  ERROR: 'game:error',
} as const;

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export interface JoinRoomPayload {
  roomCode: string;
  /** Session token issued by POST /api/rooms(/:code/join). */
  token: string;
}

export interface NightActionPayload {
  action: NightActionType;
  /** Target player id, or null to clear a pending selection. */
  targetId: string | null;
}

export interface VotePayload {
  /** Target player id, `SKIP`, or null to retract. */
  targetId: VoteTarget | null;
}

export interface ChatPayload {
  channel: ChatChannel;
  body: string;
}

export interface KickPayload {
  playerId: string;
}

export interface TransferHostPayload {
  playerId: string;
}

export interface UpdateSettingsPayload {
  settings: GameSettingsPatch;
}

export interface SetReadyPayload {
  ready: boolean;
}

export interface RematchPayload {
  vote: boolean;
}

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
}

export interface PhaseChangedPayload {
  phase: Phase;
  previousPhase: Phase;
  dayNumber: number;
  phaseStartedAt: number | null;
  phaseEndsAt: number | null;
  serverTime: number;
}

export interface TimerPayload {
  phase: Phase;
  phaseEndsAt: number | null;
  serverTime: number;
}

export interface PlayerDiedPayload {
  playerId: string;
  playerName: string;
  revealedRole: string | null;
  cause: 'MAFIA' | 'VOTE' | 'DISCONNECT' | 'HOST';
  dayNumber: number;
}

export interface VoteUpdatedPayload {
  tallies: RoomStateForClient['voteTallies'];
  votesCast: number;
  votersRemaining: number;
}

export interface AnnouncementPayload {
  headline: string;
  detail: string | null;
  tone: 'NEUTRAL' | 'DEATH' | 'RELIEF' | 'VICTORY';
}

/** Delivered to a single socket — e.g. a Detective's investigation result. */
export interface PrivateResultPayload {
  kind: 'INVESTIGATION';
  day: number;
  targetId: string;
  targetName: string;
  isMafia: boolean;
}

// ---------------------------------------------------------------------------
// Typed Socket.IO maps
// ---------------------------------------------------------------------------

/** Standard node-style ack used by every client→server call. */
export type Ack<T = void> = (
  response: { ok: true; data: T } | { ok: false; error: ErrorPayload },
) => void;

export interface ClientToServerEvents {
  [CLIENT_EVENTS.ROOM_JOIN]: (p: JoinRoomPayload, ack: Ack<RoomStateForClient>) => void;
  [CLIENT_EVENTS.ROOM_LEAVE]: (p: Record<string, never>, ack: Ack) => void;
  [CLIENT_EVENTS.ROOM_UPDATE_SETTINGS]: (p: UpdateSettingsPayload, ack: Ack) => void;
  [CLIENT_EVENTS.ROOM_KICK]: (p: KickPayload, ack: Ack) => void;
  [CLIENT_EVENTS.ROOM_TRANSFER_HOST]: (p: TransferHostPayload, ack: Ack) => void;
  [CLIENT_EVENTS.ROOM_CANCEL]: (p: Record<string, never>, ack: Ack) => void;
  [CLIENT_EVENTS.ROOM_SET_READY]: (p: SetReadyPayload, ack: Ack) => void;
  [CLIENT_EVENTS.GAME_START]: (p: Record<string, never>, ack: Ack) => void;
  [CLIENT_EVENTS.GAME_ACTION]: (p: NightActionPayload, ack: Ack) => void;
  [CLIENT_EVENTS.GAME_VOTE]: (p: VotePayload, ack: Ack) => void;
  [CLIENT_EVENTS.GAME_CHAT]: (p: ChatPayload, ack: Ack) => void;
  [CLIENT_EVENTS.GAME_REMATCH]: (p: RematchPayload, ack: Ack) => void;
  [CLIENT_EVENTS.GAME_END_EARLY]: (p: Record<string, never>, ack: Ack) => void;
  [CLIENT_EVENTS.PING]: (p: { t: number }, ack: Ack<{ t: number; serverTime: number }>) => void;
}

export interface ServerToClientEvents {
  [SERVER_EVENTS.ROOM_STATE]: (state: RoomStateForClient) => void;
  [SERVER_EVENTS.ROOM_PLAYER_JOINED]: (p: { player: PublicPlayer }) => void;
  [SERVER_EVENTS.ROOM_PLAYER_LEFT]: (p: { playerId: string; name: string }) => void;
  [SERVER_EVENTS.ROOM_CLOSED]: (p: { reason: string }) => void;
  [SERVER_EVENTS.ROOM_KICKED]: (p: { reason: string }) => void;
  [SERVER_EVENTS.GAME_STARTED]: (p: { dayNumber: number }) => void;
  [SERVER_EVENTS.GAME_PHASE_CHANGED]: (p: PhaseChangedPayload) => void;
  [SERVER_EVENTS.GAME_TIMER]: (p: TimerPayload) => void;
  [SERVER_EVENTS.GAME_PLAYER_DIED]: (p: PlayerDiedPayload) => void;
  [SERVER_EVENTS.GAME_VOTE_UPDATED]: (p: VoteUpdatedPayload) => void;
  [SERVER_EVENTS.GAME_ANNOUNCEMENT]: (p: AnnouncementPayload) => void;
  [SERVER_EVENTS.GAME_PRIVATE_RESULT]: (p: PrivateResultPayload) => void;
  [SERVER_EVENTS.GAME_CHAT]: (m: ChatMessage) => void;
  [SERVER_EVENTS.GAME_EVENT]: (e: GameEvent) => void;
  [SERVER_EVENTS.GAME_OVER]: (p: { result: GameResult }) => void;
  [SERVER_EVENTS.GAME_RESET]: (p: Record<string, never>) => void;
  [SERVER_EVENTS.ERROR]: (p: ErrorPayload) => void;
}

/** Attached to every authenticated socket by the auth middleware. */
export interface SocketData {
  playerId: string;
  roomCode: string;
  displayName: string;
}
