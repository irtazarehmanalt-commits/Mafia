import type { GameSettings, Phase } from '@mafia/shared';

/**
 * The legal transition graph. Anything not listed here is rejected outright,
 * which makes an out-of-order transition a bug that fails loudly rather than
 * a silently corrupted game.
 */
const TRANSITIONS: Record<Phase, readonly Phase[]> = {
  LOBBY: ['ROLE_REVEAL'],
  ROLE_REVEAL: ['NIGHT', 'GAME_OVER'],
  NIGHT: ['NIGHT_RESOLUTION', 'GAME_OVER'],
  NIGHT_RESOLUTION: ['DAY_ANNOUNCEMENT', 'GAME_OVER'],
  DAY_ANNOUNCEMENT: ['DISCUSSION', 'GAME_OVER'],
  DISCUSSION: ['VOTING', 'GAME_OVER'],
  VOTING: ['VOTE_RESOLUTION', 'GAME_OVER'],
  VOTE_RESOLUTION: ['NIGHT', 'GAME_OVER'],
  // A rematch rewinds the room to the lobby.
  GAME_OVER: ['LOBBY'],
};

/** Phases in which a night ability may be submitted. */
export const NIGHT_ACTION_PHASES: readonly Phase[] = ['NIGHT'];
/** Phases in which a day vote may be cast or changed. */
export const VOTING_PHASES: readonly Phase[] = ['VOTING'];
/** Phases in which living players may talk on the public channel. */
export const PUBLIC_CHAT_PHASES: readonly Phase[] = [
  'DAY_ANNOUNCEMENT',
  'DISCUSSION',
  'VOTING',
  'VOTE_RESOLUTION',
];

export class GameStateMachine {
  static canTransition(from: Phase, to: Phase): boolean {
    return (TRANSITIONS[from] ?? []).includes(to);
  }

  static assertTransition(from: Phase, to: Phase): void {
    if (!GameStateMachine.canTransition(from, to)) {
      throw new Error(`Illegal phase transition: ${from} -> ${to}`);
    }
  }

  static allowedFrom(phase: Phase): readonly Phase[] {
    return TRANSITIONS[phase] ?? [];
  }

  /**
   * The phase that follows `phase` when its timer expires and the game is not
   * over. `NIGHT_RESOLUTION` / `VOTE_RESOLUTION` are computation phases that
   * always advance; `GAME_OVER` and `LOBBY` have no automatic successor.
   */
  static nextOnTimeout(phase: Phase): Phase | null {
    switch (phase) {
      case 'ROLE_REVEAL':
        return 'NIGHT';
      case 'NIGHT':
        return 'NIGHT_RESOLUTION';
      case 'NIGHT_RESOLUTION':
        return 'DAY_ANNOUNCEMENT';
      case 'DAY_ANNOUNCEMENT':
        return 'DISCUSSION';
      case 'DISCUSSION':
        return 'VOTING';
      case 'VOTING':
        return 'VOTE_RESOLUTION';
      case 'VOTE_RESOLUTION':
        return 'NIGHT';
      default:
        return null;
    }
  }

  /** Duration in seconds, or null for phases that wait on a human. */
  static durationFor(phase: Phase, settings: GameSettings): number | null {
    switch (phase) {
      case 'LOBBY':
      case 'GAME_OVER':
        return null;
      default:
        return settings.durations[phase];
    }
  }

  static isNight(phase: Phase): boolean {
    return phase === 'NIGHT' || phase === 'NIGHT_RESOLUTION';
  }

  static isDay(phase: Phase): boolean {
    return (
      phase === 'DAY_ANNOUNCEMENT' ||
      phase === 'DISCUSSION' ||
      phase === 'VOTING' ||
      phase === 'VOTE_RESOLUTION'
    );
  }

  static isInGame(phase: Phase): boolean {
    return phase !== 'LOBBY' && phase !== 'GAME_OVER';
  }
}
