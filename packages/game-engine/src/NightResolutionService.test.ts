import { describe, expect, it } from 'vitest';
import { GameError, type GameSettings, type Role } from '@mafia/shared';
import { NightResolutionService } from './NightResolutionService';
import { seededRng } from './rng';
import { makeHarness, SIX, startWithRoles } from './testUtils';

const rng = seededRng(5);

/** Drives a harness to the first NIGHT with a known role layout. */
function atNight(settings: Partial<GameSettings> = {}, roles?: Record<string, Role>) {
  const h = makeHarness(SIX, settings);
  startWithRoles(
    h,
    roles ?? {
      Alice: 'MAFIA',
      Bob: 'DOCTOR',
      Cara: 'DETECTIVE',
      Dan: 'CIVILIAN',
      Eve: 'CIVILIAN',
      Frank: 'CIVILIAN',
    },
  );
  h.runPhaseOut(); // ROLE_REVEAL -> NIGHT
  expect(h.state().phase).toBe('NIGHT');
  return h;
}

describe('NightResolutionService — Mafia target', () => {
  it('kills the target when a lone Mafia chooses', () => {
    const h = atNight();
    h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Dan'));

    const result = NightResolutionService.resolve(h.state(), rng);
    expect(result.mafiaTargetId).toBe(h.id('Dan'));
    expect(result.killedId).toBe(h.id('Dan'));
  });

  it('kills nobody when the Mafia never agreed on anyone', () => {
    const h = atNight();
    const result = NightResolutionService.resolve(h.state(), rng);
    expect(result.mafiaTargetId).toBeNull();
    expect(result.mafiaFailureReason).toBe('NO_VOTES');
    expect(result.killedId).toBeNull();
  });

  it('kills nobody when two Mafia deadlock on different targets', () => {
    const h = makeHarness(['Alice', 'Bob', 'Cara', 'Dan', 'Eve', 'Frank', 'Gina', 'Hank']);
    startWithRoles(h, {
      Alice: 'MAFIA',
      Bob: 'MAFIA',
      Cara: 'DOCTOR',
      Dan: 'DETECTIVE',
      Eve: 'CIVILIAN',
      Frank: 'CIVILIAN',
      Gina: 'CIVILIAN',
      Hank: 'CIVILIAN',
    });
    h.runPhaseOut();

    h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Eve'));
    h.engine.submitNightAction(h.id('Bob'), 'MAFIA_KILL', h.id('Frank'));

    const result = NightResolutionService.resolve(h.state(), rng);
    expect(result.mafiaFailureReason).toBe('TIE');
    expect(result.killedId).toBeNull();
  });

  it('uses the plurality when Mafia partially agree', () => {
    const h = makeHarness(['Alice', 'Bob', 'Cara', 'Dan', 'Eve', 'Frank', 'Gina', 'Hank']);
    startWithRoles(h, {
      Alice: 'MAFIA',
      Bob: 'MAFIA',
      Cara: 'DOCTOR',
      Dan: 'DETECTIVE',
      Eve: 'CIVILIAN',
      Frank: 'CIVILIAN',
      Gina: 'CIVILIAN',
      Hank: 'CIVILIAN',
    });
    h.runPhaseOut();

    // Only one of the two Mafia bothers to vote — that is still a plurality.
    h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Eve'));

    const result = NightResolutionService.resolve(h.state(), rng);
    expect(result.killedId).toBe(h.id('Eve'));
  });

  it('rejects a Mafia targeting a fellow Mafia', () => {
    const h = makeHarness(['Alice', 'Bob', 'Cara', 'Dan', 'Eve', 'Frank', 'Gina', 'Hank']);
    startWithRoles(h, {
      Alice: 'MAFIA',
      Bob: 'MAFIA',
      Cara: 'DOCTOR',
      Dan: 'DETECTIVE',
      Eve: 'CIVILIAN',
      Frank: 'CIVILIAN',
      Gina: 'CIVILIAN',
      Hank: 'CIVILIAN',
    });
    h.runPhaseOut();

    expect(() => h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Bob'))).toThrow(
      GameError,
    );
  });

  it('rejects a Mafia targeting themselves', () => {
    const h = atNight();
    expect(() => h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Alice'))).toThrow(
      GameError,
    );
  });

  it('discards a vote from a Mafia who died before resolution', () => {
    const h = atNight();
    h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Dan'));
    // Alice is removed from play before the night resolves.
    h.state().players.find((p) => p.id === h.id('Alice'))!.alive = false;

    const result = NightResolutionService.resolve(h.state(), rng);
    expect(result.killedId).toBeNull();
  });
});

describe('NightResolutionService — Doctor', () => {
  it('saves the Mafia target when they match', () => {
    const h = atNight();
    h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Dan'));
    h.engine.submitNightAction(h.id('Bob'), 'DOCTOR_PROTECT', h.id('Dan'));

    const result = NightResolutionService.resolve(h.state(), rng);
    expect(result.saveSucceeded).toBe(true);
    expect(result.killedId).toBeNull();
  });

  it('does not save when the Doctor guesses wrong', () => {
    const h = atNight();
    h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Dan'));
    h.engine.submitNightAction(h.id('Bob'), 'DOCTOR_PROTECT', h.id('Eve'));

    const result = NightResolutionService.resolve(h.state(), rng);
    expect(result.saveSucceeded).toBe(false);
    expect(result.killedId).toBe(h.id('Dan'));
  });

  it('allows self-protection by default', () => {
    const h = atNight();
    expect(() =>
      h.engine.submitNightAction(h.id('Bob'), 'DOCTOR_PROTECT', h.id('Bob')),
    ).not.toThrow();
  });

  it('blocks self-protection when the room disables it', () => {
    const h = atNight({ doctorCanSelfProtect: false });
    expect(() => h.engine.submitNightAction(h.id('Bob'), 'DOCTOR_PROTECT', h.id('Bob'))).toThrow(
      GameError,
    );
  });

  it('blocks a third consecutive protection of the same player', () => {
    const h = atNight();
    const doctor = h.id('Bob');
    const target = h.id('Dan');

    // Simulate two nights already spent guarding Dan.
    h.state().doctorHistory[doctor] = { targetId: target, count: 2 };

    const verdict = NightResolutionService.canDoctorProtect(h.state(), doctor, target);
    expect(verdict.allowed).toBe(false);
    expect(() => h.engine.submitNightAction(doctor, 'DOCTOR_PROTECT', target)).toThrow(GameError);

    // A different player is still fair game.
    expect(
      NightResolutionService.canDoctorProtect(h.state(), doctor, h.id('Eve')).allowed,
    ).toBe(true);
  });

  it('resets the consecutive counter when the Doctor switches target', () => {
    const h = atNight();
    const doctor = h.id('Bob');
    h.state().doctorHistory[doctor] = { targetId: h.id('Dan'), count: 2 };

    h.engine.submitNightAction(doctor, 'DOCTOR_PROTECT', h.id('Eve'));
    h.runPhaseOut(); // NIGHT -> NIGHT_RESOLUTION
    h.runPhaseOut(); // -> DAY_ANNOUNCEMENT applies history

    expect(h.state().doctorHistory[doctor]).toEqual({ targetId: h.id('Eve'), count: 1 });
  });

  it('rejects protecting a dead player', () => {
    const h = atNight();
    h.state().players.find((p) => p.id === h.id('Dan'))!.alive = false;
    expect(() => h.engine.submitNightAction(h.id('Bob'), 'DOCTOR_PROTECT', h.id('Dan'))).toThrow(
      GameError,
    );
  });
});

describe('NightResolutionService — Detective', () => {
  it('correctly identifies a Mafia member', () => {
    const h = atNight();
    h.engine.submitNightAction(h.id('Cara'), 'DETECTIVE_INVESTIGATE', h.id('Alice'));

    const result = NightResolutionService.resolve(h.state(), rng);
    expect(result.investigation?.isMafia).toBe(true);
    expect(result.investigation?.targetId).toBe(h.id('Alice'));
  });

  it('correctly clears a townsfolk', () => {
    const h = atNight();
    h.engine.submitNightAction(h.id('Cara'), 'DETECTIVE_INVESTIGATE', h.id('Dan'));

    const result = NightResolutionService.resolve(h.state(), rng);
    expect(result.investigation?.isMafia).toBe(false);
  });

  it('does not distinguish between Doctor and Civilian', () => {
    const h = atNight();
    h.engine.submitNightAction(h.id('Cara'), 'DETECTIVE_INVESTIGATE', h.id('Bob'));

    const result = NightResolutionService.resolve(h.state(), rng);
    expect(result.investigation?.isMafia).toBe(false);
  });

  it('rejects investigating yourself', () => {
    const h = atNight();
    expect(() =>
      h.engine.submitNightAction(h.id('Cara'), 'DETECTIVE_INVESTIGATE', h.id('Cara')),
    ).toThrow(GameError);
  });

  it('rejects investigating a dead player', () => {
    const h = atNight();
    h.state().players.find((p) => p.id === h.id('Dan'))!.alive = false;
    expect(() =>
      h.engine.submitNightAction(h.id('Cara'), 'DETECTIVE_INVESTIGATE', h.id('Dan')),
    ).toThrow(GameError);
  });

  it('yields nothing when the Detective dies before resolution', () => {
    const h = atNight();
    h.engine.submitNightAction(h.id('Cara'), 'DETECTIVE_INVESTIGATE', h.id('Alice'));
    h.state().players.find((p) => p.id === h.id('Cara'))!.alive = false;

    const result = NightResolutionService.resolve(h.state(), rng);
    expect(result.investigation).toBeNull();
  });

  it('rejects a non-Detective trying to investigate', () => {
    const h = atNight();
    expect(() =>
      h.engine.submitNightAction(h.id('Dan'), 'DETECTIVE_INVESTIGATE', h.id('Alice')),
    ).toThrow(GameError);
  });

  it('rejects a non-Doctor trying to protect', () => {
    const h = atNight();
    expect(() =>
      h.engine.submitNightAction(h.id('Dan'), 'DOCTOR_PROTECT', h.id('Alice')),
    ).toThrow(GameError);
  });

  it('rejects a Civilian trying to kill', () => {
    const h = atNight();
    expect(() => h.engine.submitNightAction(h.id('Dan'), 'MAFIA_KILL', h.id('Alice'))).toThrow(
      GameError,
    );
  });
});
