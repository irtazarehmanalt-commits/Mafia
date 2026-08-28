'use client';

import type { ClientToServerEvents, ErrorPayload, ServerToClientEvents } from '@mafia/shared';
import { io, type Socket } from 'socket.io-client';
import { SERVER_URL } from './config';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;

/**
 * One socket per browser tab, reused across route changes so a reconnect
 * doesn't reset the player's session.
 */
export function getSocket(): GameSocket {
  if (socket) return socket;

  socket = io(SERVER_URL, {
    transports: ['websocket', 'polling'],
    autoConnect: false,
    // Keep trying essentially forever with a backoff — a player on a phone
    // switching networks should reconnect on their own.
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 600,
    reconnectionDelayMax: 6000,
    timeout: 12_000,
  });

  return socket;
}

export function disposeSocket(): void {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}

export class SocketError extends Error {
  constructor(readonly payload: ErrorPayload) {
    super(payload.message);
    this.name = 'SocketError';
  }
}

/**
 * Promise wrapper around Socket.IO acknowledgements. Rejects with a
 * `SocketError` carrying the server's stable error code, so callers can show
 * the message without inspecting anything raw.
 */
export function emitWithAck<K extends keyof ClientToServerEvents, TResult>(
  target: GameSocket,
  event: K,
  payload: unknown,
  timeoutMs = 8000,
): Promise<TResult> {
  return new Promise<TResult>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new SocketError({ code: 'INTERNAL_ERROR', message: 'The server did not respond in time.' }),
      );
    }, timeoutMs);

    const callback = (response: { ok: true; data: TResult } | { ok: false; error: ErrorPayload }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (response?.ok) resolve(response.data);
      else reject(new SocketError(response?.error ?? { code: 'INTERNAL_ERROR', message: 'Failed.' }));
    };

    (target.emit as unknown as (e: string, p: unknown, cb: typeof callback) => void)(
      event as string,
      payload,
      callback,
    );
  });
}
