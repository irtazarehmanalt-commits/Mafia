import type { GameState } from '@mafia/game-engine';
import type { GameSettings } from '@mafia/shared';
import { db } from '../config/db';
import { logger } from '../config/logger';

/**
 * Durable history and crash recovery.
 *
 * Every method degrades to a no-op when Postgres is not configured, and every
 * write is best-effort: a database blip must never interrupt a live game, so
 * failures are logged and swallowed rather than thrown at players.
 */
export class GameRepository {
  static enabled(): boolean {
    return db() !== null;
  }

  static async roomCodeExists(roomCode: string): Promise<boolean> {
    const client = db();
    if (!client) return false;
    try {
      const found = await client.gameRoom.findUnique({
        where: { roomCode },
        select: { id: true },
      });
      return found !== null;
    } catch (err) {
      logger.error({ err }, 'roomCodeExists failed');
      return false;
    }
  }

  static async createRoom(params: {
    roomCode: string;
    name: string;
    settings: GameSettings;
  }): Promise<void> {
    const client = db();
    if (!client) return;
    try {
      await client.gameRoom.create({
        data: {
          roomCode: params.roomCode,
          name: params.name,
          maxPlayers: params.settings.maxPlayers,
          settings: params.settings as unknown as object,
          status: 'LOBBY',
        },
      });
    } catch (err) {
      logger.error({ err, roomCode: params.roomCode }, 'createRoom failed');
    }
  }

  /**
   * Mirrors the authoritative in-memory state into Postgres. Called on a
   * debounce rather than on every mutation, so a busy room does not turn into
   * a write storm.
   */
  static async persistSnapshot(state: GameState): Promise<void> {
    const client = db();
    if (!client) return;

    try {
      const room = await client.gameRoom.upsert({
        where: { roomCode: state.roomCode },
        update: {
          name: state.roomName,
          status: state.status,
          maxPlayers: state.settings.maxPlayers,
          settings: state.settings as unknown as object,
          closedAt: state.status === 'CANCELLED' ? new Date() : null,
        },
        create: {
          roomCode: state.roomCode,
          name: state.roomName,
          status: state.status,
          maxPlayers: state.settings.maxPlayers,
          settings: state.settings as unknown as object,
        },
        select: { id: true },
      });

      // Roster.
      await Promise.all(
        state.players.map((player) =>
          client.gamePlayer.upsert({
            where: { roomId_displayName: { roomId: room.id, displayName: player.name } },
            update: {
              guestId: player.id,
              seat: player.seat,
              isHost: player.isHost,
              isSpectator: player.isSpectator,
              // Roles are only retained while a game is actually running.
              role: state.status === 'IN_PROGRESS' ? player.role : null,
              team: state.status === 'IN_PROGRESS' && player.role
                ? player.role === 'MAFIA'
                  ? 'MAFIA'
                  : 'TOWN'
                : null,
              alive: player.alive,
              connected: player.connected,
              lastSeenAt: new Date(),
            },
            create: {
              roomId: room.id,
              guestId: player.id,
              displayName: player.name,
              seat: player.seat,
              isHost: player.isHost,
              isSpectator: player.isSpectator,
              alive: player.alive,
              connected: player.connected,
            },
          }),
        ),
      );

      if (state.gameNumber > 0) {
        await client.game.upsert({
          where: { roomId_gameNumber: { roomId: room.id, gameNumber: state.gameNumber } },
          update: {
            currentPhase: state.phase,
            phaseStartedAt: state.phaseStartedAt ? new Date(state.phaseStartedAt) : null,
            phaseEndsAt: state.phaseEndsAt ? new Date(state.phaseEndsAt) : null,
            dayNumber: state.dayNumber,
            status: state.phase === 'GAME_OVER' ? 'FINISHED' : 'ACTIVE',
            winner: state.result?.winner ?? null,
            // The snapshot is what makes a mid-game restart recoverable.
            stateSnapshot: state.phase === 'GAME_OVER' ? undefined : (state as unknown as object),
            result: state.result ? (state.result as unknown as object) : undefined,
            endedAt: state.phase === 'GAME_OVER' ? new Date() : null,
          },
          create: {
            roomId: room.id,
            gameNumber: state.gameNumber,
            currentPhase: state.phase,
            phaseStartedAt: state.phaseStartedAt ? new Date(state.phaseStartedAt) : null,
            phaseEndsAt: state.phaseEndsAt ? new Date(state.phaseEndsAt) : null,
            dayNumber: state.dayNumber,
            status: 'ACTIVE',
            stateSnapshot: state as unknown as object,
          },
        });
      }
    } catch (err) {
      logger.error({ err, roomCode: state.roomCode }, 'persistSnapshot failed');
    }
  }

  /** Rehydrate the most recent unfinished snapshot for a room. */
  static async loadSnapshot(roomCode: string): Promise<GameState | null> {
    const client = db();
    if (!client) return null;
    try {
      const room = await client.gameRoom.findUnique({
        where: { roomCode },
        select: {
          id: true,
          status: true,
          games: {
            orderBy: { gameNumber: 'desc' },
            take: 1,
            select: { stateSnapshot: true },
          },
        },
      });
      if (!room) return null;
      if (room.status === 'CANCELLED') return null;

      const snapshot = room.games[0]?.stateSnapshot;
      return snapshot ? (snapshot as unknown as GameState) : null;
    } catch (err) {
      logger.error({ err, roomCode }, 'loadSnapshot failed');
      return null;
    }
  }

  /**
   * Append-only event log. PRIVATE and SERVER rows are retained for debugging
   * and future replay, and are never served to a client — the projection layer
   * is the only path to a player.
   */
  static async recordEvents(
    roomCode: string,
    gameNumber: number,
    events: Array<{
      type: string;
      visibility: 'PUBLIC' | 'PRIVATE' | 'SERVER';
      audience: string[];
      dayNumber: number;
      phase: string;
      message: string;
      payload?: Record<string, unknown>;
    }>,
  ): Promise<void> {
    const client = db();
    if (!client || events.length === 0) return;
    try {
      const game = await client.game.findFirst({
        where: { room: { roomCode }, gameNumber },
        select: { id: true },
      });
      if (!game) return;

      await client.gameEvent.createMany({
        data: events.map((e) => ({
          gameId: game.id,
          type: e.type,
          visibility: e.visibility,
          audience: e.audience,
          dayNumber: e.dayNumber,
          phase: e.phase as never,
          message: e.message,
          payload: (e.payload ?? undefined) as object | undefined,
        })),
      });
    } catch (err) {
      logger.error({ err, roomCode }, 'recordEvents failed');
    }
  }

  static async markRoomClosed(roomCode: string): Promise<void> {
    const client = db();
    if (!client) return;
    try {
      await client.gameRoom.update({
        where: { roomCode },
        data: { status: 'CANCELLED', closedAt: new Date() },
      });
    } catch {
      // Room may never have been persisted; nothing to do.
    }
  }

  /** Housekeeping for rooms that were abandoned without being closed. */
  static async purgeStaleRooms(olderThanHours = 24): Promise<number> {
    const client = db();
    if (!client) return 0;
    try {
      const cutoff = new Date(Date.now() - olderThanHours * 3600_000);
      const result = await client.gameRoom.deleteMany({
        where: { updatedAt: { lt: cutoff }, status: { in: ['FINISHED', 'CANCELLED'] } },
      });
      return result.count;
    } catch (err) {
      logger.error({ err }, 'purgeStaleRooms failed');
      return 0;
    }
  }
}
