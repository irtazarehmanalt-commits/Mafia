import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, PHASES, type Phase } from '@mafia/shared';
import { GameStateMachine } from './GameStateMachine';

describe('GameStateMachine', () => {
  it('starts the game only on an explicit host action, never on a timer', () => {
    expect(GameStateMachine.canTransition('LOBBY', 'ROLE_REVEAL')).toBe(true);
    expect(GameStateMachine.nextOnTimeout('LOBBY')).toBeNull();
  });

  it('walks the canonical round loop', () => {
    const loop: Array<[Phase, Phase]> = [
      ['ROLE_REVEAL', 'NIGHT'],
      ['NIGHT', 'NIGHT_RESOLUTION'],
      ['NIGHT_RESOLUTION', 'DAY_ANNOUNCEMENT'],
      ['DAY_ANNOUNCEMENT', 'DISCUSSION'],
      ['DISCUSSION', 'VOTING'],
      ['VOTING', 'VOTE_RESOLUTION'],
      ['VOTE_RESOLUTION', 'NIGHT'],
    ];
    for (const [from, to] of loop) {
      expect(GameStateMachine.canTransition(from, to), `${from} -> ${to}`).toBe(true);
      expect(GameStateMachine.nextOnTimeout(from)).toBe(to);
    }
  });

  it('rejects skipping phases', () => {
    expect(GameStateMachine.canTransition('LOBBY', 'NIGHT')).toBe(false);
    expect(GameStateMachine.canTransition('NIGHT', 'VOTING')).toBe(false);
    expect(GameStateMachine.canTransition('DISCUSSION', 'NIGHT')).toBe(false);
    expect(GameStateMachine.canTransition('ROLE_REVEAL', 'DISCUSSION')).toBe(false);
  });

  it('rejects going backwards', () => {
    expect(GameStateMachine.canTransition('VOTING', 'DISCUSSION')).toBe(false);
    expect(GameStateMachine.canTransition('NIGHT', 'ROLE_REVEAL')).toBe(false);
  });

  it('allows every in-game phase to jump straight to GAME_OVER', () => {
    const inGame: Phase[] = [
      'ROLE_REVEAL',
      'NIGHT',
      'NIGHT_RESOLUTION',
      'DAY_ANNOUNCEMENT',
      'DISCUSSION',
      'VOTING',
      'VOTE_RESOLUTION',
    ];
    for (const phase of inGame) {
      expect(GameStateMachine.canTransition(phase, 'GAME_OVER'), phase).toBe(true);
    }
  });

  it('only allows GAME_OVER to rewind to the lobby', () => {
    expect(GameStateMachine.allowedFrom('GAME_OVER')).toEqual(['LOBBY']);
  });

  it('throws on an illegal transition', () => {
    expect(() => GameStateMachine.assertTransition('LOBBY', 'VOTING')).toThrow(
      /Illegal phase transition/,
    );
  });

  it('has no automatic successor for LOBBY or GAME_OVER', () => {
    expect(GameStateMachine.nextOnTimeout('LOBBY')).toBeNull();
    expect(GameStateMachine.nextOnTimeout('GAME_OVER')).toBeNull();
  });

  it('gives every timed phase a positive duration and untimed phases none', () => {
    for (const phase of PHASES) {
      const duration = GameStateMachine.durationFor(phase, DEFAULT_SETTINGS);
      if (phase === 'LOBBY' || phase === 'GAME_OVER') {
        expect(duration, phase).toBeNull();
      } else {
        expect(duration, phase).toBeGreaterThan(0);
      }
    }
  });

  it('classifies day and night phases', () => {
    expect(GameStateMachine.isNight('NIGHT')).toBe(true);
    expect(GameStateMachine.isNight('NIGHT_RESOLUTION')).toBe(true);
    expect(GameStateMachine.isDay('DISCUSSION')).toBe(true);
    expect(GameStateMachine.isDay('VOTING')).toBe(true);
    expect(GameStateMachine.isDay('NIGHT')).toBe(false);
    expect(GameStateMachine.isInGame('LOBBY')).toBe(false);
    expect(GameStateMachine.isInGame('GAME_OVER')).toBe(false);
  });
});
