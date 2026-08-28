import { resolveRoleCounts, type GameSettings, type Role } from '@mafia/shared';
import { cryptoRng, shuffle, type Rng } from './rng';

export type RoleAssignment = Record<string, Role>;

export class RoleAssignmentService {
  /**
   * Deals one role to each seated player using a cryptographically secure
   * shuffle. Never called with the client in the loop — the result lives only
   * on the server.
   *
   * @param previous  The assignment from the last game. When supplied, the
   *                  service avoids handing out an identical mapping again so
   *                  a rematch always feels fresh.
   */
  static assign(
    playerIds: readonly string[],
    settings: GameSettings,
    rng: Rng = cryptoRng,
    previous?: RoleAssignment | null,
  ): RoleAssignment {
    if (playerIds.length === 0) return {};

    const deck = RoleAssignmentService.buildDeck(playerIds.length, settings);

    // A single distinct arrangement exists when every player gets the same
    // role, in which case retrying is pointless.
    const distinctRoles = new Set(deck).size;
    const maxAttempts = distinctRoles > 1 && previous ? 12 : 1;

    let assignment: RoleAssignment = {};
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      assignment = RoleAssignmentService.deal(playerIds, deck, rng);
      if (!previous || !RoleAssignmentService.isSameAssignment(assignment, previous)) break;
    }
    return assignment;
  }

  /** The multiset of roles for a given player count. */
  static buildDeck(playerCount: number, settings: GameSettings): Role[] {
    const counts = resolveRoleCounts(playerCount, settings.roleCountOverride);
    const deck: Role[] = [];
    for (let i = 0; i < counts.MAFIA; i++) deck.push('MAFIA');
    for (let i = 0; i < counts.DOCTOR; i++) deck.push('DOCTOR');
    for (let i = 0; i < counts.DETECTIVE; i++) deck.push('DETECTIVE');
    while (deck.length < playerCount) deck.push('CIVILIAN');
    return deck.slice(0, playerCount);
  }

  private static deal(
    playerIds: readonly string[],
    deck: readonly Role[],
    rng: Rng,
  ): RoleAssignment {
    const shuffled = shuffle(deck, rng);
    const assignment: RoleAssignment = {};
    playerIds.forEach((id, index) => {
      assignment[id] = shuffled[index] ?? 'CIVILIAN';
    });
    return assignment;
  }

  private static isSameAssignment(a: RoleAssignment, b: RoleAssignment): boolean {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((k) => a[k] === b[k]);
  }
}
