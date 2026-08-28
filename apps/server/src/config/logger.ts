import pino from 'pino';
import { env } from './env';

export const logger = pino({
  level: env.LOG_LEVEL,
  // Pretty output locally; structured JSON in production for log shipping.
  transport: env.isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
  // Never let a stray token or role reach the logs.
  redact: {
    paths: ['token', '*.token', 'req.headers.authorization', 'role', '*.role', 'players[*].role'],
    censor: '[redacted]',
  },
});

export type Logger = typeof logger;
