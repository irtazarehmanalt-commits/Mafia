/** Public runtime configuration, inlined at build time by Next. */
export const SERVER_URL =
  process.env.NEXT_PUBLIC_SOCKET_SERVER_URL?.replace(/\/$/, '') ?? 'http://localhost:4000';

export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ??
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');

export function inviteLink(roomCode: string): string {
  return `${APP_URL}/room/${roomCode}`;
}
