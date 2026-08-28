import { describe, expect, it } from 'vitest';
import { SKIP_VOTE, type GameSettings } from '@mafia/shared';
import { VotingService } from './VotingService';
import { seededRng } from './rng';
import { makeHarness, SIX, startWithRoles } from './testUtils';

const rng = seededRng(99);

/** Drives a harness into the VOTING phase with a known role layout. */
function atVoting(settings: Partial<GameSettings> = {}) {
  const h = makeHarness(SIX, settings);
  startWithRoles(h, {
    Alice: 'MAFIA',
    Bob: 'DOCTOR',
    Cara: 'DETECTIVE',
    Dan: 'CIVILIAN',
    Eve: 'CIVILIAN',
    Frank: 'CIVILIAN',
  });
  h.runPhaseOut(); // ROLE_REVEAL -> NIGHT
  h.runPhaseOut(); // NIGHT -> NIGHT_RESOLUTION
  h.runPhaseOut(); // -> DAY_ANNOUNCEMENT
  h.runPhaseOut(); // -> DISCUSSION
  h.runPhaseOut(); // -> VOTING
  expect(h.state().phase).toBe('VOTING');
  return h;
}

describe('VotingService', () => {
  it('eliminates the player with the most votes', () => {
    const h = atVoting();
    h.engine.castVote(h.id('Alice'), h.id('Dan'));
    h.engine.castVote(h.id('Bob'), h.id('Dan'));
    h.engine.castVote(h.id('Cara'), h.id('Eve'));

    const outcome = VotingService.resolve(h.state(), rng);
    expect(outcome.outcome).toBe('ELIMINATED');
    expect(outcome.eliminatedId).toBe(h.id('Dan'));
  });

  it('eliminates nobody when the top vote is tied', () => {
    const h = atVoting();
    h.engine.castVote(h.id('Alice'), h.id('Dan'));
    h.engine.castVote(h.id('Bob'), h.id('Eve'));

    const outcome = VotingService.resolve(h.state(), rng);
    expect(outcome.outcome).toBe('TIE');
    expect(outcome.eliminatedId).toBeNull();
    expect(outcome.tiedIds).toHaveLength(2);
  });

  it('breaks a tie randomly when the room is configured that way', () => {
    const h = atVoting({ tieRule: 'RANDOM' });
    h.engine.castVote(h.id('Alice'), h.id('Dan'));
    h.engine.castVote(h.id('Bob'), h.id('Eve'));

    const outcome = VotingService.resolve(h.state(), rng);
    expect(outcome.outcome).toBe('ELIMINATED');
    expect([h.id('Dan'), h.id('Eve')]).toContain(outcome.eliminatedId);
  });

  it('eliminates nobody when Skip wins outright', () => {
    const h = atVoting();
    h.engine.castVote(h.id('Alice'), SKIP_VOTE);
    h.engine.castVote(h.id('Bob'), SKIP_VOTE);
    h.engine.castVote(h.id('Cara'), h.id('Dan'));

    const outcome = VotingService.resolve(h.state(), rng);
    expect(outcome.outcome).toBe('SKIPPED');
    expect(outcome.eliminatedId).toBeNull();
  });

  it('never eliminates on a random tie-break involving Skip', () => {
    const h = atVoting({ tieRule: 'RANDOM' });
    h.engine.castVote(h.id('Alice'), SKIP_VOTE);
    h.engine.castVote(h.id('Bob'), h.id('Dan'));

    const outcome = VotingService.resolve(h.state(), rng);
    // Dan is the only real candidate, so he is the one who goes.
    expect(outcome.eliminatedId).toBe(h.id('Dan'));
  });

  it('reports NO_VOTES when nobody voted', () => {
    const h = atVoting();
    const outcome = VotingService.resolve(h.state(), rng);
    expect(outcome.outcome).toBe('NO_VOTES');
    expect(outcome.eliminatedId).toBeNull();
  });

  it('lets a player change their vote, counting only the latest', () => {
    const h = atVoting();
    h.engine.castVote(h.id('Alice'), h.id('Dan'));
    h.engine.castVote(h.id('Alice'), h.id('Eve'));

    const tallies = VotingService.tally(h.state());
    expect(tallies).toHaveLength(1);
    expect(tallies[0]?.targetId).toBe(h.id('Eve'));
    expect(tallies[0]?.votes).toBe(1);
  });

  it('lets a player retract their vote', () => {
    const h = atVoting();
    h.engine.castVote(h.id('Alice'), h.id('Dan'));
    h.engine.castVote(h.id('Alice'), null);
    expect(VotingService.tally(h.state())).toHaveLength(0);
  });

  it('counts two simultaneous votes for the same target independently', () => {
    const h = atVoting();
    h.engine.castVote(h.id('Alice'), h.id('Dan'));
    h.engine.castVote(h.id('Bob'), h.id('Dan'));

    const tallies = VotingService.tally(h.state());
    expect(tallies[0]?.votes).toBe(2);
    expect(tallies[0]?.voterIds).toEqual(
      expect.arrayContaining([h.id('Alice'), h.id('Bob')]),
    );
  });

  it('tracks how many living players have yet to vote', () => {
    const h = atVoting();
    expect(VotingService.pendingVoters(h.state())).toBe(6);
    h.engine.castVote(h.id('Alice'), h.id('Dan'));
    expect(VotingService.pendingVoters(h.state())).toBe(5);
  });
});
