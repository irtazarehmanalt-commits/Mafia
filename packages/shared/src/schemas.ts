import { z } from 'zod';
import {
  ABSOLUTE_MAX_PLAYERS,
  ABSOLUTE_MIN_PLAYERS,
  DURATION_BOUNDS,
} from './settings';

/** Room codes are unambiguous uppercase: no O/0/I/1. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(ROOM_CODE_LENGTH)
  .regex(new RegExp(`^[${ROOM_CODE_ALPHABET}]+$`), 'Invalid room code');

export const displayNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(20)
  // Letters (any script), digits, space, and a few safe punctuation marks.
  .regex(/^[\p{L}\p{N} _.'-]+$/u, 'Name contains unsupported characters');

export const roomNameSchema = z.string().trim().min(2).max(40);

export const playerIdSchema = z.string().uuid();

const durationsSchema = z
  .object(
    Object.fromEntries(
      Object.entries(DURATION_BOUNDS).map(([key, bounds]) => [
        key,
        z.number().int().min(bounds.min).max(bounds.max),
      ]),
    ) as Record<keyof typeof DURATION_BOUNDS, z.ZodNumber>,
  )
  .partial();

export const roleCountsSchema = z.object({
  MAFIA: z.number().int().min(0).max(7),
  DOCTOR: z.number().int().min(0).max(1),
  DETECTIVE: z.number().int().min(0).max(1),
});

/** Every field optional — this is a patch, applied through `sanitizeSettings`. */
export const gameSettingsPatchSchema = z
  .object({
    maxPlayers: z.number().int().min(ABSOLUTE_MIN_PLAYERS).max(ABSOLUTE_MAX_PLAYERS),
    minPlayers: z.number().int().min(ABSOLUTE_MIN_PLAYERS).max(ABSOLUTE_MAX_PLAYERS),
    durations: durationsSchema,
    revealRoleOnDeath: z.boolean(),
    doctorCanSelfProtect: z.boolean(),
    doctorMaxConsecutiveSameTarget: z.number().int().min(1).max(99),
    publicVotes: z.boolean(),
    allowSkipVote: z.boolean(),
    tieRule: z.enum(['NO_ELIMINATION', 'RANDOM']),
    disconnectPolicy: z.enum(['KEEP_INACTIVE', 'ELIMINATE']),
    reconnectGraceSeconds: z.number().int().min(15).max(600),
    allowSpectators: z.boolean(),
    deadChatEnabled: z.boolean(),
    roleCountOverride: roleCountsSchema.nullable(),
  })
  .partial()
  .strict();

// ---------------------------------------------------------------------------
// HTTP request bodies
// ---------------------------------------------------------------------------

export const createRoomBodySchema = z.object({
  displayName: displayNameSchema,
  roomName: roomNameSchema,
  settings: gameSettingsPatchSchema.optional(),
});

export const joinRoomBodySchema = z.object({
  displayName: displayNameSchema,
  /** Present when reclaiming an existing seat after clearing site data. */
  token: z.string().max(1024).optional(),
  asSpectator: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Socket payloads
// ---------------------------------------------------------------------------

export const joinRoomSocketSchema = z.object({
  roomCode: roomCodeSchema,
  token: z.string().min(1).max(1024),
});

export const nightActionSchema = z.object({
  action: z.enum(['MAFIA_KILL', 'DOCTOR_PROTECT', 'DETECTIVE_INVESTIGATE']),
  targetId: playerIdSchema.nullable(),
});

export const voteSchema = z.object({
  targetId: z.union([playerIdSchema, z.literal('SKIP')]).nullable(),
});

export const chatSchema = z.object({
  channel: z.enum(['LOBBY', 'DAY', 'MAFIA', 'DEAD']),
  body: z.string().trim().min(1).max(500),
});

export const kickSchema = z.object({ playerId: playerIdSchema });
export const transferHostSchema = z.object({ playerId: playerIdSchema });
export const updateSettingsSchema = z.object({ settings: gameSettingsPatchSchema });
export const setReadySchema = z.object({ ready: z.boolean() });
export const rematchSchema = z.object({ vote: z.boolean() });
export const pingSchema = z.object({ t: z.number() });
export const emptySchema = z.object({}).passthrough();

export type CreateRoomBody = z.infer<typeof createRoomBodySchema>;
export type JoinRoomBody = z.infer<typeof joinRoomBodySchema>;
// The canonical `GameSettingsPatch` type lives in ./settings — the schema above
// is its runtime validator, not a second source of truth.
