import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Optional. Without it the server runs fully in memory (ephemeral rooms). */
  DATABASE_URL: z.string().min(1).optional(),
  /** Optional. Enables the Socket.IO Redis adapter and shared state. */
  REDIS_URL: z.string().min(1).optional(),

  AUTH_SECRET: z.string().min(16).default('dev-only-insecure-secret-change-me-in-production'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast and loudly — a misconfigured server should never boot.
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const raw = parsed.data;

const isProduction = raw.NODE_ENV === 'production';

// Session tokens are HMAC-signed with this key. Booting production with the
// public development default would let anyone forge a token for any seat in
// any room, so refuse to start rather than come up insecure.
if (isProduction && raw.AUTH_SECRET.startsWith('dev-only-insecure')) {
  console.error(
    [
      'AUTH_SECRET is not set.',
      '',
      'This key signs player session tokens. Starting without it would let',
      'anyone forge a session for any seat, so the server will not boot.',
      '',
      'Set it in your host\'s environment settings (Render: Environment →',
      'Add Environment Variable), then redeploy. Generate a value with:',
      '',
      '  openssl rand -base64 48',
      '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"',
    ].join('\n'),
  );
  process.exit(1);
}

/**
 * Browsers send `Origin` as a full URL, but hosting platforms often expose a
 * service address as a bare hostname. Normalise so `nightfall-web.onrender.com`
 * and `https://nightfall-web.onrender.com` both match.
 */
function normalizeOrigin(value: string): string {
  const raw = value.trim();
  if (!raw || raw === '*') return raw;
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/$/, '');
  const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|$)/.test(raw);
  return `${local ? 'http' : 'https'}://${raw}`.replace(/\/$/, '');
}

export const env = {
  ...raw,
  isProduction,
  isDevelopment: raw.NODE_ENV === 'development',
  /** Parsed allow-list used by both CORS and the Socket.IO handshake. */
  corsOrigins: raw.CORS_ORIGIN.split(',')
    .map((o) => normalizeOrigin(o))
    .filter(Boolean),
  databaseEnabled: Boolean(raw.DATABASE_URL),
  redisEnabled: Boolean(raw.REDIS_URL),
} as const;

export type Env = typeof env;
