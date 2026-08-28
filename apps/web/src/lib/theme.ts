import type { Phase } from '@mafia/shared';

/**
 * The town is lit by day and inverted by night. One class on the outermost
 * wrapper re-points every design token, so no screen carries two palettes.
 */
export function isNightPhase(phase: Phase): boolean {
  switch (phase) {
    case 'ROLE_REVEAL':
    case 'NIGHT':
    case 'NIGHT_RESOLUTION':
    case 'VOTING':
    case 'VOTE_RESOLUTION':
    case 'GAME_OVER':
      return true;
    default:
      return false;
  }
}

/** Initials for the avatar squares. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase();
}
