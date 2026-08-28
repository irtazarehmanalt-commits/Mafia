import type { GameSettings, PhaseDurations, RoleCounts } from './types';

/** Seconds. Mirrors the spec's recommended pacing. */
export const DEFAULT_DURATIONS: PhaseDurations = {
  ROLE_REVEAL: 15,
  NIGHT: 45,
  NIGHT_RESOLUTION: 4,
  DAY_ANNOUNCEMENT: 10,
  DISCUSSION: 120,
  VOTING: 60,
  VOTE_RESOLUTION: 8,
};

export const ABSOLUTE_MIN_PLAYERS = 4;
export const RECOMMENDED_MIN_PLAYERS = 6;
export const ABSOLUTE_MAX_PLAYERS = 15;

export const DEFAULT_SETTINGS: GameSettings = {
  maxPlayers: 10,
  minPlayers: RECOMMENDED_MIN_PLAYERS,
  durations: { ...DEFAULT_DURATIONS },
  revealRoleOnDeath: true,
  doctorCanSelfProtect: true,
  doctorMaxConsecutiveSameTarget: 2,
  publicVotes: true,
  allowSkipVote: true,
  tieRule: 'NO_ELIMINATION',
  disconnectPolicy: 'KEEP_INACTIVE',
  reconnectGraceSeconds: 90,
  allowSpectators: true,
  deadChatEnabled: true,
  roleCountOverride: null,
};

/** Bounds enforced server-side when a host edits settings. */
export const DURATION_BOUNDS: Record<keyof PhaseDurations, { min: number; max: number }> = {
  ROLE_REVEAL: { min: 5, max: 60 },
  NIGHT: { min: 15, max: 180 },
  NIGHT_RESOLUTION: { min: 2, max: 15 },
  DAY_ANNOUNCEMENT: { min: 5, max: 60 },
  DISCUSSION: { min: 20, max: 600 },
  VOTING: { min: 15, max: 300 },
  VOTE_RESOLUTION: { min: 3, max: 30 },
};

/**
 * Role balancing table. The band is chosen by living player count at game
 * start; a host may override it entirely via `roleCountOverride`.
 */
export interface RoleBand {
  min: number;
  max: number;
  counts: RoleCounts;
}

export const ROLE_BANDS: RoleBand[] = [
  { min: 4, max: 5, counts: { MAFIA: 1, DOCTOR: 1, DETECTIVE: 1 } },
  { min: 6, max: 7, counts: { MAFIA: 1, DOCTOR: 1, DETECTIVE: 1 } },
  { min: 8, max: 10, counts: { MAFIA: 2, DOCTOR: 1, DETECTIVE: 1 } },
  { min: 11, max: 15, counts: { MAFIA: 3, DOCTOR: 1, DETECTIVE: 1 } },
];

/**
 * Resolve the role distribution for a given player count.
 * Always leaves at least one Civilian and keeps Mafia below parity at start.
 */
export function resolveRoleCounts(playerCount: number, override: RoleCounts | null): RoleCounts {
  if (override) return clampRoleCounts(playerCount, override);
  const band = ROLE_BANDS.find((b) => playerCount >= b.min && playerCount <= b.max);
  const counts = band ? { ...band.counts } : { MAFIA: 1, DOCTOR: 1, DETECTIVE: 1 };
  return clampRoleCounts(playerCount, counts);
}

/**
 * Guarantees a startable configuration:
 *  - specials never exceed the player count
 *  - Mafia never start at or above parity (that would be an instant win)
 */
export function clampRoleCounts(playerCount: number, counts: RoleCounts): RoleCounts {
  const maxMafia = Math.max(1, Math.ceil(playerCount / 2) - 1);
  const mafia = Math.min(Math.max(0, Math.floor(counts.MAFIA)), maxMafia);

  let doctor = Math.min(Math.max(0, Math.floor(counts.DOCTOR)), 1);
  let detective = Math.min(Math.max(0, Math.floor(counts.DETECTIVE)), 1);

  // Keep at least one plain Civilian so the town is never all-special.
  while (mafia + doctor + detective >= playerCount) {
    if (detective > 0) detective -= 1;
    else if (doctor > 0) doctor -= 1;
    else break;
  }

  return { MAFIA: mafia, DOCTOR: doctor, DETECTIVE: detective };
}

/**
 * A settings edit. Distinct from `Partial<GameSettings>` because `durations`
 * itself is partial — a host changing only the discussion timer must not have
 * to resend every other duration.
 */
export interface GameSettingsPatch extends Partial<Omit<GameSettings, 'durations'>> {
  durations?: Partial<PhaseDurations>;
}

/** Merge a settings patch onto a base, clamping every field into range. */
export function sanitizeSettings(
  base: GameSettings,
  patch: GameSettingsPatch,
): GameSettings {
  const merged: GameSettings = {
    ...base,
    ...patch,
    durations: { ...base.durations, ...(patch.durations ?? {}) },
  };

  merged.maxPlayers = clamp(merged.maxPlayers, ABSOLUTE_MIN_PLAYERS, ABSOLUTE_MAX_PLAYERS);
  merged.minPlayers = clamp(merged.minPlayers, ABSOLUTE_MIN_PLAYERS, merged.maxPlayers);
  merged.doctorMaxConsecutiveSameTarget = clamp(merged.doctorMaxConsecutiveSameTarget, 1, 99);
  merged.reconnectGraceSeconds = clamp(merged.reconnectGraceSeconds, 15, 600);

  for (const key of Object.keys(DURATION_BOUNDS) as Array<keyof PhaseDurations>) {
    const bounds = DURATION_BOUNDS[key];
    merged.durations[key] = clamp(Math.round(merged.durations[key]), bounds.min, bounds.max);
  }

  if (merged.roleCountOverride) {
    merged.roleCountOverride = clampRoleCounts(merged.maxPlayers, merged.roleCountOverride);
  }

  return merged;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
