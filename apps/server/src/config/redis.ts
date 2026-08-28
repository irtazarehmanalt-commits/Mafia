import { Redis } from 'ioredis';
import { env } from './env';
import { logger } from './logger';

/**
 * Redis is optional but strongly recommended in production. It provides:
 *  - the Socket.IO adapter, so rooms fan out across multiple server instances
 *  - a shared, fast store for live game snapshots
 */
let pubClient: Redis | null = null;
let subClient: Redis | null = null;
let stateClient: Redis | null = null;

function createClient(label: string): Redis {
  const client = new Redis(env.REDIS_URL as string, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 200, 3000),
  });
  client.on('error', (err) => logger.error({ err, label }, 'Redis error'));
  return client;
}

export async function connectRedis(): Promise<boolean> {
  if (!env.redisEnabled) {
    logger.warn('REDIS_URL is not set — using the single-instance in-memory adapter.');
    return false;
  }
  try {
    pubClient = createClient('pub');
    subClient = createClient('sub');
    stateClient = createClient('state');
    await Promise.all([pubClient.connect(), subClient.connect(), stateClient.connect()]);
    logger.info('Connected to Redis.');
    return true;
  } catch (err) {
    logger.error({ err }, 'Could not connect to Redis — continuing without it.');
    pubClient = subClient = stateClient = null;
    return false;
  }
}

export function redisAdapterClients(): { pub: Redis; sub: Redis } | null {
  if (!pubClient || !subClient) return null;
  return { pub: pubClient, sub: subClient };
}

export function redisState(): Redis | null {
  return stateClient;
}

export async function disconnectRedis(): Promise<void> {
  await Promise.all(
    [pubClient, subClient, stateClient].map(async (c) => {
      if (c) await c.quit().catch(() => undefined);
    }),
  );
}
