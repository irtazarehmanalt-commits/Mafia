import { createServer } from 'node:http';

import { createAdapter } from '@socket.io/redis-adapter';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
} from '@mafia/shared';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { Server } from 'socket.io';

import { connectDatabase, disconnectDatabase } from './config/db';
import { env } from './config/env';
import { logger } from './config/logger';
import { connectRedis, disconnectRedis, redisAdapterClients } from './config/redis';
import { createRouter } from './http/routes';
import { initStateStore } from './persistence/StateStore';
import { RoomManager } from './rooms/RoomManager';
import { registerSocketHandlers } from './socket/SocketService';

async function main(): Promise<void> {
  await connectDatabase();
  const redisReady = await connectRedis();
  initStateStore(redisReady);

  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins.includes('*') ? true : env.corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '32kb' }));

  const httpServer = createServer(app);

  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(httpServer, {
    cors: {
      origin: env.corsOrigins.includes('*') ? true : env.corsOrigins,
      credentials: true,
    },
    // Long enough to ride out a phone changing networks, short enough that a
    // genuinely gone player is noticed promptly.
    pingTimeout: 25_000,
    pingInterval: 20_000,
    connectionStateRecovery: {
      maxDisconnectionDuration: 60_000,
      skipMiddlewares: false,
    },
  });

  // With Redis attached, emits fan out across every server instance, so rooms
  // are no longer confined to a single process.
  const adapterClients = redisAdapterClients();
  if (adapterClients) {
    io.adapter(createAdapter(adapterClients.pub, adapterClients.sub));
    logger.info('Socket.IO Redis adapter enabled.');
  }

  const manager = new RoomManager(io);
  app.use('/api', createRouter(manager));

  // This host serves JSON and WebSockets only — the playable site is the web
  // app. Say so plainly, because someone will inevitably open the root URL.
  app.get('/', (_req, res) => {
    res.json({
      name: 'nightfall-server',
      status: 'ok',
      note: 'This is the Nightfall game server (API + WebSockets). The game itself is served by the web app.',
      health: '/api/health',
    });
  });

  registerSocketHandlers(io, manager);

  httpServer.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        env: env.NODE_ENV,
        database: env.databaseEnabled ? 'postgres' : 'ephemeral',
        redis: redisReady ? 'connected' : 'disabled',
        origins: env.corsOrigins,
      },
      `Mafia game server listening on :${env.PORT}`,
    );
  });

  // Flush every live room before the process goes away, so a deploy does not
  // cost anyone a game in progress.
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down…');
    io.close();
    await manager.shutdown();
    await disconnectRedis();
    await disconnectDatabase();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });
}

void main();
