/** Public runtime configuration, inlined at build time by Next. */

/**
 * Hosting platforms often expose a service address as a bare hostname
 * (`nightfall-server.onrender.com`) rather than a full URL. Socket.IO and
 * `fetch` both need a scheme, so add one when it is missing — https, unless
 * this is plainly a local address.
 */
function normalizeUrl(value: string | undefined, fallback: string): string {
  const raw = value?.trim();
  if (!raw) return fallback;
  const withScheme = /^https?:\/\//i.test(raw)
    ? raw
    : `${/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|$)/.test(raw) ? 'http' : 'https'}://${raw}`;
  return withScheme.replace(/\/$/, '');
}

export const SERVER_URL = normalizeUrl(
  process.env.NEXT_PUBLIC_SOCKET_SERVER_URL,
  'http://localhost:4000',
);

export const APP_URL = normalizeUrl(
  process.env.NEXT_PUBLIC_APP_URL,
  typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
);

export function inviteLink(roomCode: string): string {
  return `${APP_URL}/room/${roomCode}`;
}
