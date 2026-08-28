import {
  GameEngine,
  VotingService,
  readableChannels,
  type EngineEffect,
  type GameState,
} from '@mafia/game-engine';
import {
  SERVER_EVENTS,
  type ChatChannel,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from '@mafia/shared';
import type { Server } from 'socket.io';

import { logger } from '../config/logger';
import { GameRepository } from '../persistence/GameRepository';
import { stateStore } from '../persistence/StateStore';

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/** Every socket for a player joins this room, so emits work across instances. */
export function playerRoom(playerId: string): string {
  return `player:${playerId}`;
}

/**
 * A short beat after the last input lands, so players see their choice
 * register before the phase flips.
 */
const EARLY_ADVANCE_DELAY_MS = 1500;
/** Debounce window for mirroring state into Postgres. */
const PERSIST_DEBOUNCE_MS = 1200;
/** Safety re-sync of the countdown, in case a client's clock drifts. */
const TIMER_HEARTBEAT_MS = 10_000;

/**
 * Owns one room: its engine, its timers and its broadcasts.
 *
 * The engine decides *what* happened; this class decides *who is told* and
 * *when the clock runs out*. Nothing here contains game rules.
 */
export class RoomRuntime {
  readonly roomCode: string;
  private readonly engine: GameEngine;
  private readonly io: IO;

  private phaseTimer: NodeJS.Timeout | null = null;
  private earlyAdvanceTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private persistTimer: NodeJS.Timeout | null = null;
  private readonly disconnectTimers = new Map<string, NodeJS.Timeout>();

  /** Live socket count per player — a player may have several tabs open. */
  private readonly socketCounts = new Map<string, number>();

  private disposed = false;
  lastActivityAt = Date.now();

  constructor(io: IO, engine: GameEngine) {
    this.io = io;
    this.engine = engine;
    this.roomCode = engine.roomCode;
    this.schedulePhaseTimer();
    this.startHeartbeat();
  }

  // -------------------------------------------------------------------------
  // Public surface used by socket handlers
  // -------------------------------------------------------------------------

  get state(): GameState {
    return this.engine.getState();
  }

  getEngine(): GameEngine {
    return this.engine;
  }

  projectFor(playerId: string) {
    return this.engine.projectFor(playerId);
  }

  isClosed(): boolean {
    return this.state.status === 'CANCELLED';
  }

  /** Nobody has a live socket here. */
  isDeserted(): boolean {
    return this.socketCounts.size === 0;
  }

  /**
   * Runs an engine mutation and fans out whatever it produced. Every socket
   * handler funnels through here, which is why broadcasting can never be
   * forgotten at a call site.
   */
  run(mutation: (engine: GameEngine) => EngineEffect[]): void {
    this.lastActivityAt = Date.now();
    const effects = mutation(this.engine);
    this.applyEffects(effects);
  }

  // -------------------------------------------------------------------------
  // Connection tracking
  // -------------------------------------------------------------------------

  registerSocket(playerId: string): void {
    this.lastActivityAt = Date.now();
    const next = (this.socketCounts.get(playerId) ?? 0) + 1;
    this.socketCounts.set(playerId, next);

    // Cancel any pending abandonment for this player.
    const timer = this.disconnectTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(playerId);
    }

    if (next === 1) this.run((engine) => engine.setConnected(playerId, true));
    else this.sendStateTo(playerId);
  }

  unregisterSocket(playerId: string): void {
    const remaining = (this.socketCounts.get(playerId) ?? 1) - 1;
    if (remaining > 0) {
      this.socketCounts.set(playerId, remaining);
      return;
    }
    this.socketCounts.delete(playerId);

    this.run((engine) => engine.setConnected(playerId, false));

    // The player keeps their seat, their role and their state for the whole
    // grace window; only afterwards does the room decide what to do with them.
    const graceMs = this.state.settings.reconnectGraceSeconds * 1000;
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(playerId);
      if (this.disposed) return;
      this.run((engine) => engine.handleReconnectTimeout(playerId));
    }, graceMs);
    timer.unref?.();
    this.disconnectTimers.set(playerId, timer);
  }

  // -------------------------------------------------------------------------
  // Effect fan-out
  // -------------------------------------------------------------------------

  private applyEffects(effects: EngineEffect[]): void {
    if (effects.length === 0) return;

    let needsBroadcast = false;
    let phaseChanged = false;

    for (const effect of effects) {
      switch (effect.kind) {
        case 'STATE_DIRTY':
          needsBroadcast = true;
          break;

        case 'PHASE_CHANGED': {
          phaseChanged = true;
          needsBroadcast = true;
          this.io.to(this.roomCode).emit(SERVER_EVENTS.GAME_PHASE_CHANGED, {
            phase: effect.to,
            previousPhase: effect.from,
            dayNumber: effect.dayNumber,
            phaseStartedAt: this.state.phaseStartedAt,
            phaseEndsAt: this.state.phaseEndsAt,
            serverTime: Date.now(),
          });
          break;
        }

        case 'GAME_STARTED':
          this.io.to(this.roomCode).emit(SERVER_EVENTS.GAME_STARTED, {
            dayNumber: effect.dayNumber,
          });
          needsBroadcast = true;
          break;

        case 'PLAYER_DIED':
          this.io.to(this.roomCode).emit(SERVER_EVENTS.GAME_PLAYER_DIED, effect.payload);
          needsBroadcast = true;
          break;

        case 'ANNOUNCEMENT':
          this.io.to(this.roomCode).emit(SERVER_EVENTS.GAME_ANNOUNCEMENT, effect.payload);
          break;

        case 'PRIVATE_RESULT':
          // Straight to one player's personal room — never the game room.
          this.io
            .to(playerRoom(effect.playerId))
            .emit(SERVER_EVENTS.GAME_PRIVATE_RESULT, effect.payload);
          break;

        case 'CHAT':
          this.emitChat(effect.message.channel, effect.message);
          break;

        case 'EVENT': {
          const event = effect.event;
          if (event.visibility === 'SERVER') break; // operators only
          if (event.visibility === 'PUBLIC') {
            this.io.to(this.roomCode).emit(SERVER_EVENTS.GAME_EVENT, event);
          } else {
            for (const recipient of event.audience) {
              this.io.to(playerRoom(recipient)).emit(SERVER_EVENTS.GAME_EVENT, event);
            }
          }
          break;
        }

        case 'VOTE_UPDATED':
          this.emitVoteUpdate();
          needsBroadcast = true;
          break;

        case 'GAME_OVER':
          this.io.to(this.roomCode).emit(SERVER_EVENTS.GAME_OVER, { result: effect.result });
          needsBroadcast = true;
          break;

        case 'GAME_RESET':
          this.io.to(this.roomCode).emit(SERVER_EVENTS.GAME_RESET, {});
          needsBroadcast = true;
          break;

        case 'PLAYER_JOINED': {
          const player = this.state.players.find((p) => p.id === effect.playerId);
          if (player) {
            this.io.to(this.roomCode).emit(SERVER_EVENTS.ROOM_PLAYER_JOINED, {
              player: {
                id: player.id,
                name: player.name,
                seat: player.seat,
                isHost: player.isHost,
                alive: player.alive,
                connected: player.connected,
                isSpectator: player.isSpectator,
                ready: player.ready,
                revealedRole: player.revealedRole,
                diedOnDay: player.diedOnDay,
              },
            });
          }
          needsBroadcast = true;
          break;
        }

        case 'PLAYER_LEFT':
          this.io.to(this.roomCode).emit(SERVER_EVENTS.ROOM_PLAYER_LEFT, {
            playerId: effect.playerId,
            name: effect.name,
          });
          needsBroadcast = true;
          break;

        case 'ROOM_CLOSED':
          this.io.to(this.roomCode).emit(SERVER_EVENTS.ROOM_CLOSED, { reason: effect.reason });
          void GameRepository.markRoomClosed(this.roomCode);
          void stateStore().delete(this.roomCode);
          this.dispose();
          return;
      }
    }

    if (needsBroadcast) this.broadcastState();
    if (phaseChanged) this.schedulePhaseTimer();
    this.considerEarlyAdvance();
    this.schedulePersist();
  }

  /** Sends every player their own redacted view of the room. */
  broadcastState(): void {
    if (this.disposed) return;
    for (const player of this.state.players) {
      this.io
        .to(playerRoom(player.id))
        .emit(SERVER_EVENTS.ROOM_STATE, this.engine.projectFor(player.id));
    }
  }

  sendStateTo(playerId: string): void {
    this.io.to(playerRoom(playerId)).emit(SERVER_EVENTS.ROOM_STATE, this.engine.projectFor(playerId));
  }

  /**
   * Chat is delivered only to players whose channel permissions include it —
   * the Mafia channel genuinely never reaches a Civilian's socket.
   */
  private emitChat(channel: ChatChannel, message: Parameters<ServerToClientEvents['game:chat']>[0]): void {
    for (const player of this.state.players) {
      if (readableChannels(this.state, player).has(channel)) {
        this.io.to(playerRoom(player.id)).emit(SERVER_EVENTS.GAME_CHAT, message);
      }
    }
  }

  private emitVoteUpdate(): void {
    const publicTallies = this.state.settings.publicVotes
      ? VotingService.tally(this.state)
      : null;
    const votesCast = Object.keys(this.state.votes).length;

    this.io.to(this.roomCode).emit(SERVER_EVENTS.GAME_VOTE_UPDATED, {
      tallies: publicTallies,
      votesCast,
      votersRemaining: VotingService.pendingVoters(this.state),
    });
  }

  // -------------------------------------------------------------------------
  // Timers — the server is the only clock that matters
  // -------------------------------------------------------------------------

  private schedulePhaseTimer(): void {
    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
    if (this.disposed) return;

    const endsAt = this.state.phaseEndsAt;
    if (endsAt === null) return;

    const delay = Math.max(0, endsAt - Date.now());
    const timer = setTimeout(() => {
      this.phaseTimer = null;
      if (this.disposed) return;
      this.run((engine) => engine.tick(Date.now()));
    }, delay);
    timer.unref?.();
    this.phaseTimer = timer;
  }

  /**
   * Ends a phase early once there is nothing left to wait for. Without this a
   * six-player game spends two minutes staring at a finished night.
   */
  private considerEarlyAdvance(): void {
    if (this.earlyAdvanceTimer || this.disposed) return;

    const phase = this.state.phase;
    const ready =
      (phase === 'NIGHT' && this.engine.allNightActionsSubmitted()) ||
      (phase === 'VOTING' && VotingService.everyoneVoted(this.state));

    if (!ready) return;

    const timer = setTimeout(() => {
      this.earlyAdvanceTimer = null;
      if (this.disposed) return;
      // Re-check: someone may have changed their mind in the meantime.
      const current = this.state.phase;
      const stillReady =
        (current === 'NIGHT' && this.engine.allNightActionsSubmitted()) ||
        (current === 'VOTING' && VotingService.everyoneVoted(this.state));
      if (stillReady) this.run((engine) => engine.advance());
    }, EARLY_ADVANCE_DELAY_MS);
    timer.unref?.();
    this.earlyAdvanceTimer = timer;
  }

  private startHeartbeat(): void {
    const timer = setInterval(() => {
      if (this.disposed) return;
      if (this.state.phaseEndsAt === null) return;
      this.io.to(this.roomCode).emit(SERVER_EVENTS.GAME_TIMER, {
        phase: this.state.phase,
        phaseEndsAt: this.state.phaseEndsAt,
        serverTime: Date.now(),
      });
    }, TIMER_HEARTBEAT_MS);
    timer.unref?.();
    this.heartbeatTimer = timer;
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private schedulePersist(): void {
    void stateStore().save(this.state);

    if (this.persistTimer || !GameRepository.enabled()) return;
    const timer = setTimeout(() => {
      this.persistTimer = null;
      void GameRepository.persistSnapshot(this.state);
    }, PERSIST_DEBOUNCE_MS);
    timer.unref?.();
    this.persistTimer = timer;
  }

  async flush(): Promise<void> {
    await stateStore().save(this.state);
    if (GameRepository.enabled()) await GameRepository.persistSnapshot(this.state);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    if (this.earlyAdvanceTimer) clearTimeout(this.earlyAdvanceTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.persistTimer) clearTimeout(this.persistTimer);
    for (const timer of this.disconnectTimers.values()) clearTimeout(timer);
    this.disconnectTimers.clear();
    logger.debug({ roomCode: this.roomCode }, 'Room runtime disposed');
  }
}
