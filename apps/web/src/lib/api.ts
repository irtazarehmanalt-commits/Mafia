'use client';

import { ERROR_MESSAGES, type ErrorCode, type GameSettingsPatch } from '@mafia/shared';
import { SERVER_URL } from './config';

export interface JoinTicket {
  roomCode: string;
  playerId: string;
  token: string;
  displayName: string;
}

export interface RoomPreview {
  roomCode: string;
  roomName: string;
  status: string;
  phase: string;
  playerCount: number;
  maxPlayers: number;
  minPlayers: number;
  allowSpectators: boolean;
  inProgress: boolean;
  players: Array<{ name: string; connected: boolean }>;
}

/** An error the UI can render directly — never a raw server message. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${SERVER_URL}/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    // Network-level failure: the server is unreachable, not misbehaving.
    throw new ApiError('INTERNAL_ERROR', 'Could not reach the game server. Is it running?');
  }

  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const err = body as { code?: ErrorCode; message?: string } | null;
    const code = err?.code ?? 'INTERNAL_ERROR';
    throw new ApiError(code, err?.message ?? ERROR_MESSAGES[code] ?? 'Something went wrong.');
  }

  return body as T;
}

export function createRoom(input: {
  displayName: string;
  roomName: string;
  settings?: GameSettingsPatch;
}): Promise<JoinTicket> {
  return request<JoinTicket>('/rooms', { method: 'POST', body: JSON.stringify(input) });
}

export function joinRoom(
  roomCode: string,
  input: { displayName: string; token?: string; asSpectator?: boolean },
): Promise<JoinTicket> {
  return request<JoinTicket>(`/rooms/${roomCode.toUpperCase()}/join`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getRoomPreview(roomCode: string): Promise<RoomPreview> {
  return request<RoomPreview>(`/rooms/${roomCode.toUpperCase()}`);
}
