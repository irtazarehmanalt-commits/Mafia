import { SKIP_VOTE, type VoteTally, type VoteTarget } from '@mafia/shared';
import { findPlayer, livingPlayers, type GameState } from './state';
import { pickOne, type Rng } from './rng';

export interface VoteOutcome {
  tallies: VoteTally[];
  /** The player to eliminate, or null. */
  eliminatedId: string | null;
  outcome: 'ELIMINATED' | 'TIE' | 'SKIPPED' | 'NO_VOTES';
  /** Ids that shared the top count when the vote tied. */
  tiedIds: string[];
}

export class VotingService {
  /**
   * Tally the current votes. Only living, seated players' votes count; votes
   * pointing at players who have since died are discarded. `SKIP` is tallied
   * like any other option, so a winning `SKIP` means nobody is eliminated.
   */
  static tally(state: GameState): VoteTally[] {
    const living = livingPlayers(state);
    const livingIds = new Set(living.map((p) => p.id));
    const counts = new Map<VoteTarget, string[]>();

    for (const [voterId, targetId] of Object.entries(state.votes)) {
      if (!livingIds.has(voterId)) continue;
      if (targetId !== SKIP_VOTE && !livingIds.has(targetId)) continue;
      const bucket = counts.get(targetId) ?? [];
      bucket.push(voterId);
      counts.set(targetId, bucket);
    }

    const tallies: VoteTally[] = [...counts.entries()].map(([targetId, voterIds]) => ({
      targetId,
      targetName: targetId === SKIP_VOTE ? 'Skip' : (findPlayer(state, targetId)?.name ?? 'Unknown'),
      votes: voterIds.length,
      voterIds,
    }));

    // Highest first, then alphabetical for a stable render order.
    tallies.sort((a, b) => b.votes - a.votes || a.targetName.localeCompare(b.targetName));
    return tallies;
  }

  static resolve(state: GameState, rng: Rng): VoteOutcome {
    const tallies = VotingService.tally(state);

    if (tallies.length === 0) {
      return { tallies, eliminatedId: null, outcome: 'NO_VOTES', tiedIds: [] };
    }

    const top = tallies[0]?.votes ?? 0;
    const leaders = tallies.filter((t) => t.votes === top);

    if (leaders.length > 1) {
      const tiedIds = leaders.map((t) => String(t.targetId));

      if (state.settings.tieRule === 'RANDOM') {
        // A random pick among tied *players* — never among "Skip".
        const candidates = tiedIds.filter((id) => id !== SKIP_VOTE);
        const chosen = pickOne(candidates, rng);
        if (chosen) {
          return { tallies, eliminatedId: chosen, outcome: 'ELIMINATED', tiedIds };
        }
      }

      return { tallies, eliminatedId: null, outcome: 'TIE', tiedIds };
    }

    const winner = leaders[0];
    if (!winner || winner.targetId === SKIP_VOTE) {
      return { tallies, eliminatedId: null, outcome: 'SKIPPED', tiedIds: [] };
    }

    return {
      tallies,
      eliminatedId: String(winner.targetId),
      outcome: 'ELIMINATED',
      tiedIds: [],
    };
  }

  /** How many living players still have not registered a vote. */
  static pendingVoters(state: GameState): number {
    const living = livingPlayers(state);
    return living.filter((p) => state.votes[p.id] === undefined).length;
  }

  /**
   * True once every living, connected player has voted — used to end the
   * voting phase early rather than burning the whole clock.
   */
  static everyoneVoted(state: GameState): boolean {
    const eligible = livingPlayers(state).filter((p) => p.connected);
    if (eligible.length === 0) return false;
    return eligible.every((p) => state.votes[p.id] !== undefined);
  }
}
