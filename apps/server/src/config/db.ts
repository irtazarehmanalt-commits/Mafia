import { PrismaClient } from '@prisma/client';
import { env } from './env';
import { logger } from './logger';

/**
 * Postgres is optional.
 *
 * With `DATABASE_URL` set the server persists rooms, snapshots and history, so
 * a restart resumes in-flight games. Without it the server still runs — rooms
 * simply live and die with the process, which makes local development and
 * demos zero-setup.
 */
let client: PrismaClient | null = null;

if (env.databaseEnabled) {
  client = new PrismaClient({
    log: env.isDevelopment ? ['warn', 'error'] : ['error'],
  });
}

/**
 * Always access the client through this accessor rather than a captured
 * binding — `client` is set to null if the connection fails at boot, and call
 * sites must observe that.
 */
export function db(): PrismaClient | null {
  return client;
}

export async function connectDatabase(): Promise<boolean> {
  if (!client) {
    logger.warn(
      'DATABASE_URL is not set — running in ephemeral mode. Rooms will not survive a restart.',
    );
    return false;
  }
  try {
    await client.$connect();
    logger.info('Connected to PostgreSQL.');
    return true;
  } catch (err) {
    logger.error({ err }, 'Could not connect to PostgreSQL — falling back to ephemeral mode.');
    client = null;
    return false;
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (client) await client.$disconnect();
}
