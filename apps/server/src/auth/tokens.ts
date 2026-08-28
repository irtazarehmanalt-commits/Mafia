import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { GameError } from '@mafia/shared';
import { env } from '../config/env';

/**
 * Player sessions are stateless HMAC-signed tokens rather than DB sessions, so
 * a reconnecting socket can be authenticated without a round trip and without
 * the client ever holding anything the server has to trust.
 *
 * The token binds a player id to one specific room: presenting a valid token
 * for room A grants nothing in room B.
 */
export interface SessionClaims {
  /** Stable player id — the seat this token owns. */
  sub: string;
  /** Room this token is scoped to. */
  room: string;
  /** Display name at issue time (advisory only; the room roster is truth). */
  name: string;
  /** Issued-at, epoch seconds. */
  iat: number;
}

/** Tokens outlive a long game but not an abandoned browser tab forever. */
const TOKEN_TTL_SECONDS = 60 * 60 * 12;

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64url(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

function sign(payload: string): string {
  return base64url(createHmac('sha256', env.AUTH_SECRET).update(payload).digest());
}

export function issueToken(claims: Omit<SessionClaims, 'iat'>): string {
  const full: SessionClaims = { ...claims, iat: Math.floor(Date.now() / 1000) };
  const payload = base64url(JSON.stringify(full));
  return `${payload}.${sign(payload)}`;
}

/**
 * Verifies signature, expiry and — when `expectedRoom` is given — room scope.
 * Throws `NOT_AUTHENTICATED` for anything that does not check out; callers
 * never learn *why* a token failed.
 */
export function verifyToken(token: string, expectedRoom?: string): SessionClaims {
  const parts = token.split('.');
  if (parts.length !== 2) throw new GameError('NOT_AUTHENTICATED', 401);

  const [payload, signature] = parts as [string, string];

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new GameError('NOT_AUTHENTICATED', 401);
  }

  let claims: SessionClaims;
  try {
    claims = JSON.parse(fromBase64url(payload).toString('utf8')) as SessionClaims;
  } catch {
    throw new GameError('NOT_AUTHENTICATED', 401);
  }

  if (!claims.sub || !claims.room || typeof claims.iat !== 'number') {
    throw new GameError('NOT_AUTHENTICATED', 401);
  }

  if (Math.floor(Date.now() / 1000) - claims.iat > TOKEN_TTL_SECONDS) {
    throw new GameError('NOT_AUTHENTICATED', 401);
  }

  // A token is only ever valid for the room it was minted for.
  if (expectedRoom && claims.room !== expectedRoom.toUpperCase()) {
    throw new GameError('NOT_AUTHENTICATED', 401);
  }

  return claims;
}

export function newPlayerId(): string {
  return randomUUID();
}
