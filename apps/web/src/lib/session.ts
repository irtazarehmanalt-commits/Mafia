'use client';

/**
 * Per-room session persistence.
 *
 * The token is what lets a player survive a refresh or a dropped connection
 * and reclaim the exact same seat — including their role. It is scoped per
 * room code so a player can hold sessions for several rooms at once.
 */
export interface StoredSession {
  roomCode: string;
  playerId: string;
  token: string;
  displayName: string;
}

const key = (roomCode: string) => `mafia:session:${roomCode.toUpperCase()}`;
const NAME_KEY = 'mafia:lastName';

function available(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    // Private browsing modes can throw on access rather than returning null.
    return false;
  }
}

export function saveSession(session: StoredSession): void {
  if (!available()) return;
  try {
    window.localStorage.setItem(key(session.roomCode), JSON.stringify(session));
    window.localStorage.setItem(NAME_KEY, session.displayName);
  } catch {
    /* storage full or blocked — the game still works, just not across refreshes */
  }
}

export function loadSession(roomCode: string): StoredSession | null {
  if (!available()) return null;
  try {
    const raw = window.localStorage.getItem(key(roomCode));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.token || !parsed?.playerId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSession(roomCode: string): void {
  if (!available()) return;
  try {
    window.localStorage.removeItem(key(roomCode));
  } catch {
    /* ignore */
  }
}

/** Remembered display name, so returning players don't retype it. */
export function lastDisplayName(): string {
  if (!available()) return '';
  try {
    return window.localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
