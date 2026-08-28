import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, resolveRoleCounts, type Role } from '@mafia/shared';
import { RoleAssignmentService } from './RoleAssignmentService';
import { cryptoRng, seededRng } from './rng';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

function countRoles(assignment: Record<string, Role>): Record<Role, number> {
  const counts: Record<Role, number> = { MAFIA: 0, DOCTOR: 0, DETECTIVE: 0, CIVILIAN: 0 };
  for (const role of Object.values(assignment)) counts[role] += 1;
  return counts;
}

describe('RoleAssignmentService', () => {
  it('gives every player exactly one role', () => {
    for (const n of [4, 6, 8, 11, 15]) {
      const players = ids(n);
      const assignment = RoleAssignmentService.assign(players, DEFAULT_SETTINGS, cryptoRng);
      expect(Object.keys(assignment)).toHaveLength(n);
      for (const id of players) expect(assignment[id]).toBeDefined();
    }
  });

  it('follows the balancing table for each player-count band', () => {
    const cases: Array<[number, number]> = [
      [6, 1],
      [7, 1],
      [8, 2],
      [10, 2],
      [11, 3],
      [15, 3],
    ];
    for (const [playerCount, expectedMafia] of cases) {
      const assignment = RoleAssignmentService.assign(
        ids(playerCount),
        DEFAULT_SETTINGS,
        cryptoRng,
      );
      const counts = countRoles(assignment);
      expect(counts.MAFIA, `${playerCount} players`).toBe(expectedMafia);
      expect(counts.DOCTOR).toBe(1);
      expect(counts.DETECTIVE).toBe(1);
      expect(counts.CIVILIAN).toBe(playerCount - expectedMafia - 2);
    }
  });

  it('never starts the Mafia at or above parity', () => {
    for (let n = 4; n <= 15; n++) {
      const counts = resolveRoleCounts(n, null);
      expect(counts.MAFIA).toBeLessThan(n - counts.MAFIA);
    }
  });

  it('always leaves at least one plain Civilian', () => {
    for (let n = 4; n <= 15; n++) {
      const counts = resolveRoleCounts(n, null);
      expect(counts.MAFIA + counts.DOCTOR + counts.DETECTIVE).toBeLessThan(n);
    }
  });

  it('clamps a host override that would break the game', () => {
    // Six Mafia in a six-player game would be an instant Mafia win.
    const counts = resolveRoleCounts(6, { MAFIA: 6, DOCTOR: 1, DETECTIVE: 1 });
    expect(counts.MAFIA).toBeLessThanOrEqual(2);
    expect(counts.MAFIA + counts.DOCTOR + counts.DETECTIVE).toBeLessThan(6);
  });

  it('honours a valid host override', () => {
    const settings = { ...DEFAULT_SETTINGS, roleCountOverride: { MAFIA: 2, DOCTOR: 0, DETECTIVE: 1 } };
    const counts = countRoles(RoleAssignmentService.assign(ids(8), settings, cryptoRng));
    expect(counts).toEqual({ MAFIA: 2, DOCTOR: 0, DETECTIVE: 1, CIVILIAN: 5 });
  });

  it('avoids handing out the identical mapping on a rematch', () => {
    const players = ids(8);
    const previous = RoleAssignmentService.assign(players, DEFAULT_SETTINGS, seededRng(7));
    const next = RoleAssignmentService.assign(players, DEFAULT_SETTINGS, seededRng(7), previous);
    // Same seed would normally reproduce the same deal; the retry loop must
    // detect the collision and reshuffle.
    expect(next).not.toEqual(previous);
  });

  it('produces a well-mixed distribution over many deals', () => {
    // Every player should be able to draw Mafia; a broken shuffle usually
    // pins the role to the first seats.
    const players = ids(8);
    const mafiaCounts = new Map<string, number>(players.map((p) => [p, 0]));

    for (let i = 0; i < 600; i++) {
      const assignment = RoleAssignmentService.assign(players, DEFAULT_SETTINGS, cryptoRng);
      for (const [id, role] of Object.entries(assignment)) {
        if (role === 'MAFIA') mafiaCounts.set(id, (mafiaCounts.get(id) ?? 0) + 1);
      }
    }

    for (const player of players) {
      // Expected ~150 of 600. A very loose band still catches a stuck shuffle.
      expect(mafiaCounts.get(player)).toBeGreaterThan(70);
    }
  });
});
