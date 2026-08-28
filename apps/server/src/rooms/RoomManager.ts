import { GameEngine, type GameState } from '@mafia/game-engine';
import {
  DEFAULT_SETTINGS,
  GameError,
  sanitizeSettings,
  type ClientToServerEvents,
  type GameSettingsPatch,
  type ServerToClientEvents,
  type SocketData,
} from '@mafia/shared';
import type { Server } from 'socket.io';

import { issueToken, newPlayerId, verifyToken } from '../auth/tokens';
import { logger } from '../config/logger';
import { GameRepository } from '../persistence/GameRepository';
import { stateStore } from '../persistence/StateStore';
import { generateUniqueRoomCode } from '../utils/roomCode';
import { RoomRuntime } from './RoomRuntime';

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/** How long a room with nobody connected is kept warm before being unloaded. */
const DESERTED_TTL_MS = 10 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;
/**
 * How long a name is held between issuing a token and the socket claiming the
 * seat. Long enough to cover a slow page load, short enough that an abandoned
 * join does not lock a name up.
 */
const RESERVATION_TTL_MS = 2 * 60 * 1000;

interface Reservation {
  playerId: string;
  expiresAt: number;
}

export interface JoinTicket {
  roomCode: string;
  playerId: string;
  token: string;
  displayName: string;
}

/**
 * The registry of live rooms.
 *
 * Rooms are lazily hydrated: if a code is not resident in memory the manager
 * looks in the shared state store and then in Postgres, so an in-flight game
 * survives a server restart.
 */
export class RoomManager {
  private readonly rooms = new Map<string, RoomRuntime>();
  /**
   * Names held for players who have a token but have not connected yet.
   * Seats are only created when the socket arrives, so without this a second
   * person could pass the join form with a name that is already spoken for and
   * only discover the clash after the page had loaded.
   */
  private readonly reservations = new Map<string, Map<string, Reservation>>();
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(private readonly io: IO) {
    const timer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    timer.unref?.();
    this.sweepTimer = timer;
  }

  // -------------------------------------------------------------------------
  // Creation & joining
  // -------------------------------------------------------------------------

  async createRoom(params: {
    displayName: string;
    roomName: string;
    settings?: GameSettingsPatch;
  }): Promise<JoinTicket> {
    const roomCode = await generateUniqueRoomCode((code) => this.codeTaken(code));
    const settings = sanitizeSettings(DEFAULT_SETTINGS, params.settings ?? {});

    const engine = GameEngine.create({
      roomCode,
      roomName: params.roomName,
      hostId: '',
      settings,
    });

    const runtime = new RoomRuntime(this.io, engine);
    this.rooms.set(roomCode, runtime);

    await GameRepository.createRoom({ roomCode, name: params.roomName, settings });
    await stateStore().save(runtime.state);

    logger.info({ roomCode }, 'Room created');

    // The seat itself is claimed when the socket connects; this only mints the
    // credential that will claim it, and holds the host's name until then.
    const playerId = newPlayerId();
    this.reserveName(roomCode, params.displayName, playerId);
    return {
      roomCode,
      playerId,
      displayName: params.displayName,
      token: issueToken({ sub: playerId, room: roomCode, name: params.displayName }),
    };
  }

  /**
   * Pre-flight for joining. Validates what it can up front so the browser gets
   * a clean HTTP error, then mints a token. The roster itself is only mutated
   * once the socket connects, which keeps seat allocation in one place.
   */
  async prepareJoin(params: {
    roomCode: string;
    displayName: string;
    token?: string;
    asSpectator?: boolean;
  }): Promise<JoinTicket> {
    const roomCode = params.roomCode.toUpperCase();
    const runtime = await this.getRuntime(roomCode);
    if (!runtime) throw new GameError('ROOM_NOT_FOUND', 404);
    if (runtime.isClosed()) throw new GameError('ROOM_CLOSED', 410);

    const state = runtime.state;

    // Returning player: a valid token for this room reclaims the same seat.
    if (params.token) {
      try {
        const claims = verifyToken(params.token, roomCode);
        const existing = state.players.find((p) => p.id === claims.sub);
        if (existing) {
          return {
            roomCode,
            playerId: existing.id,
            displayName: existing.name,
            token: params.token,
          };
        }
      } catch {
        // Expired or foreign token — fall through and treat as a new player.
      }
    }

    const name = params.displayName.trim();
    const taken =
      state.players.some((p) => p.name.toLowerCase() === name.toLowerCase()) ||
      this.isNameReserved(roomCode, name);
    if (taken) throw new GameError('NAME_TAKEN', 409);

    const mustSpectate = state.phase !== 'LOBBY';
    if (mustSpectate && !state.settings.allowSpectators) {
      throw new GameError('GAME_ALREADY_STARTED', 409);
    }

    const seated = state.players.filter((p) => !p.isSpectator).length;
    if (!mustSpectate && !params.asSpectator && seated >= state.settings.maxPlayers) {
      throw new GameError('ROOM_FULL', 409);
    }

    const playerId = newPlayerId();
    this.reserveName(roomCode, name, playerId);
    return {
      roomCode,
      playerId,
      displayName: name,
      token: issueToken({ sub: playerId, room: roomCode, name }),
    };
  }

  // -------------------------------------------------------------------------
  // Name reservations
  // -------------------------------------------------------------------------

  private reserveName(roomCode: string, name: string, playerId: string): void {
    let forRoom = this.reservations.get(roomCode);
    if (!forRoom) {
      forRoom = new Map();
      this.reservations.set(roomCode, forRoom);
    }
    forRoom.set(name.toLowerCase(), { playerId, expiresAt: Date.now() + RESERVATION_TTL_MS });
  }

  private isNameReserved(roomCode: string, name: string): boolean {
    const forRoom = this.reservations.get(roomCode);
    if (!forRoom) return false;
    const entry = forRoom.get(name.toLowerCase());
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) {
      forRoom.delete(name.toLowerCase());
      return false;
    }
    return true;
  }

  /** Called once a socket has actually taken the seat. */
  confirmJoin(roomCode: string, playerId: string): void {
    const forRoom = this.reservations.get(roomCode.toUpperCase());
    if (!forRoom) return;
    for (const [name, entry] of forRoom) {
      if (entry.playerId === playerId) forRoom.delete(name);
    }
    if (forRoom.size === 0) this.reservations.delete(roomCode.toUpperCase());
  }

  // -------------------------------------------------------------------------
  // Lookup & hydration
  // -------------------------------------------------------------------------

  /** In-memory only — used on hot paths where hydration would be wrong. */
  peek(roomCode: string): RoomRuntime | null {
    return this.rooms.get(roomCode.toUpperCase()) ?? null;
  }

  async getRuntime(roomCode: string): Promise<RoomRuntime | null> {
    const code = roomCode.toUpperCase();
    const resident = this.rooms.get(code);
    if (resident) return resident;

    const snapshot = await this.loadSnapshot(code);
    if (!snapshot) return null;
    if (snapshot.status === 'CANCELLED') return null;

    const runtime = this.hydrate(snapshot);
    this.rooms.set(code, runtime);
    logger.info({ roomCode: code }, 'Room rehydrated from storage');
    return runtime;
  }

  private async loadSnapshot(roomCode: string): Promise<GameState | null> {
    const fromStore = await stateStore().load(roomCode);
    if (fromStore) return fromStore;
    return GameRepository.loadSnapshot(roomCode);
  }

  /**
   * Rebuilds a runtime from a snapshot. Everyone is marked disconnected first:
   * their sockets are gone, and each will flip back to connected as it returns.
   */
  private hydrate(snapshot: GameState): RoomRuntime {
    for (const player of snapshot.players) {
      player.connected = false;
    }

    // A phase whose deadline passed while the server was down is resolved
    // immediately rather than leaving the room frozen.
    const engine = new GameEngine(snapshot);
    const runtime = new RoomRuntime(this.io, engine);
    if (snapshot.phaseEndsAt !== null && snapshot.phaseEndsAt <= Date.now()) {
      runtime.run((e) => e.tick(Date.now()));
    }
    return runtime;
  }

  private async codeTaken(code: string): Promise<boolean> {
    if (this.rooms.has(code)) return true;
    if (await stateStore().load(code)) return true;
    return GameRepository.roomCodeExists(code);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Unload rooms that nobody is connected to, after a grace period. */
  private sweep(): void {
    const now = Date.now();

    // Drop name holds nobody ever claimed.
    for (const [code, forRoom] of this.reservations) {
      for (const [name, entry] of forRoom) {
        if (entry.expiresAt <= now) forRoom.delete(name);
      }
      if (forRoom.size === 0) this.reservations.delete(code);
    }

    for (const [code, runtime] of this.rooms) {
      if (!runtime.isDeserted()) continue;
      if (now - runtime.lastActivityAt < DESERTED_TTL_MS) continue;

      // State is already in the store, so unloading loses nothing — a player
      // returning with a valid link simply rehydrates the room.
      void runtime.flush().finally(() => runtime.dispose());
      this.rooms.delete(code);
      this.reservations.delete(code);
      logger.info({ roomCode: code }, 'Unloaded deserted room');
    }
  }

  async shutdown(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    await Promise.all(
      [...this.rooms.values()].map(async (runtime) => {
        await runtime.flush().catch(() => undefined);
        runtime.dispose();
      }),
    );
    this.rooms.clear();
  }

  get size(): number {
    return this.rooms.size;
  }

  stats(): { rooms: number; players: number } {
    let players = 0;
    for (const runtime of this.rooms.values()) players += runtime.state.players.length;
    return { rooms: this.rooms.size, players };
  }
}
