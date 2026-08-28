import type { GameState } from '@mafia/game-engine';
import { logger } from '../config/logger';
import { redisState } from '../config/redis';

/**
 * Fast shared storage for live game snapshots.
 *
 * With Redis available this is what lets several server instances serve the
 * same room and lets a restarted instance pick a game back up mid-round.
 * Without it we degrade to a process-local map, which is correct for a single
 * instance and simply does not survive a restart.
 */
export interface StateStore {
  save(state: GameState): Promise<void>;
  load(roomCode: string): Promise<GameState | null>;
  delete(roomCode: string): Promise<void>;
  listRoomCodes(): Promise<string[]>;
}

const KEY_PREFIX = 'mafia:room:';
/** Abandoned rooms evaporate rather than accumulating forever. */
const TTL_SECONDS = 60 * 60 * 6;

class RedisStateStore implements StateStore {
  async save(state: GameState): Promise<void> {
    const client = redisState();
    if (!client) return;
    try {
      await client.set(
        `${KEY_PREFIX}${state.roomCode}`,
        JSON.stringify(state),
        'EX',
        TTL_SECONDS,
      );
    } catch (err) {
      logger.error({ err, roomCode: state.roomCode }, 'Failed to save room state to Redis');
    }
  }

  async load(roomCode: string): Promise<GameState | null> {
    const client = redisState();
    if (!client) return null;
    try {
      const raw = await client.get(`${KEY_PREFIX}${roomCode}`);
      return raw ? (JSON.parse(raw) as GameState) : null;
    } catch (err) {
      logger.error({ err, roomCode }, 'Failed to load room state from Redis');
      return null;
    }
  }

  async delete(roomCode: string): Promise<void> {
    const client = redisState();
    if (!client) return;
    await client.del(`${KEY_PREFIX}${roomCode}`).catch(() => undefined);
  }

  async listRoomCodes(): Promise<string[]> {
    const client = redisState();
    if (!client) return [];
    const keys = await client.keys(`${KEY_PREFIX}*`).catch(() => [] as string[]);
    return keys.map((k) => k.slice(KEY_PREFIX.length));
  }
}

class MemoryStateStore implements StateStore {
  private readonly map = new Map<string, string>();

  async save(state: GameState): Promise<void> {
    // Stored serialised so behaviour matches Redis exactly (no shared refs).
    this.map.set(state.roomCode, JSON.stringify(state));
  }

  async load(roomCode: string): Promise<GameState | null> {
    const raw = this.map.get(roomCode);
    return raw ? (JSON.parse(raw) as GameState) : null;
  }

  async delete(roomCode: string): Promise<void> {
    this.map.delete(roomCode);
  }

  async listRoomCodes(): Promise<string[]> {
    return [...this.map.keys()];
  }
}

let store: StateStore = new MemoryStateStore();

export function initStateStore(useRedis: boolean): void {
  store = useRedis ? new RedisStateStore() : new MemoryStateStore();
  logger.info(`State store: ${useRedis ? 'Redis' : 'in-memory'}`);
}

export function stateStore(): StateStore {
  return store;
}
