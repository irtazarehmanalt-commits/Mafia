/**
 * Stable, client-safe error codes. The server never leaks raw exceptions to
 * players — it maps everything onto one of these.
 */
export const ERROR_CODES = [
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'ROOM_CLOSED',
  'GAME_ALREADY_STARTED',
  'NAME_TAKEN',
  'INVALID_NAME',
  'INVALID_ROOM_CODE',
  'NOT_AUTHENTICATED',
  'NOT_IN_ROOM',
  'NOT_HOST',
  'NOT_ENOUGH_PLAYERS',
  'INVALID_PHASE',
  'NOT_ALIVE',
  'INVALID_TARGET',
  'INVALID_ROLE_FOR_ACTION',
  'ALREADY_ACTED',
  'SPECTATORS_CANNOT_ACT',
  'RATE_LIMITED',
  'VALIDATION_FAILED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Player-facing copy. Deliberately free of implementation detail. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  ROOM_NOT_FOUND: 'Room not found. Check the code and try again.',
  ROOM_FULL: 'This room is full.',
  ROOM_CLOSED: 'This room is no longer available.',
  GAME_ALREADY_STARTED: 'The game has already started.',
  NAME_TAKEN: 'That name is already taken in this room.',
  INVALID_NAME: 'Please choose a name between 2 and 20 characters.',
  INVALID_ROOM_CODE: 'That room code does not look right.',
  NOT_AUTHENTICATED: 'Your session expired. Please rejoin the room.',
  NOT_IN_ROOM: 'You are not a member of this room.',
  NOT_HOST: 'Only the host can do that.',
  NOT_ENOUGH_PLAYERS: 'You need more players before the game can start.',
  INVALID_PHASE: 'You cannot do that right now.',
  NOT_ALIVE: 'You are no longer alive.',
  INVALID_TARGET: 'That target is not valid.',
  INVALID_ROLE_FOR_ACTION: 'Your role cannot perform that action.',
  ALREADY_ACTED: 'You have already acted this phase.',
  SPECTATORS_CANNOT_ACT: 'Spectators cannot take part in the game.',
  RATE_LIMITED: 'Slow down a moment.',
  VALIDATION_FAILED: 'That request was not valid.',
  INTERNAL_ERROR: 'Something went wrong. Please try again.',
};

/** Thrown inside the server; caught at the socket/HTTP boundary. */
export class GameError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;

  constructor(code: ErrorCode, httpStatus = 400, detail?: string) {
    super(detail ?? ERROR_MESSAGES[code]);
    this.name = 'GameError';
    this.code = code;
    this.httpStatus = httpStatus;
  }

  toPayload(): { code: ErrorCode; message: string } {
    return { code: this.code, message: ERROR_MESSAGES[this.code] };
  }
}

export function isGameError(err: unknown): err is GameError {
  return err instanceof GameError;
}
