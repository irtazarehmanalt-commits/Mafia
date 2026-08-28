import { randomInt } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@mafia/shared';

/**
 * Generates a room code from an alphabet with no visually ambiguous glyphs
 * (no O/0, no I/1), because these get read aloud and typed by hand.
 */
export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Generates a code that is not already taken, giving up after a bounded number
 * of attempts rather than looping forever.
 */
export async function generateUniqueRoomCode(
  isTaken: (code: string) => boolean | Promise<boolean>,
  maxAttempts = 12,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = generateRoomCode();
    if (!(await isTaken(code))) return code;
  }
  throw new Error('Could not allocate an unused room code');
}
