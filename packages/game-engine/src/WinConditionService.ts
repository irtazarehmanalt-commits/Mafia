import type { Team } from '@mafia/shared';
import { livingMafia, livingTown, type GameState } from './state';

export interface WinEvaluation {
  winner: Team | null;
  reason: string;
}

/**
 * Evaluated after every night resolution and every elimination.
 *
 *  - Town wins the moment the last Mafia dies.
 *  - Mafia win when they equal or outnumber the remaining town, because the
 *    town can no longer out-vote them.
 */
export class WinConditionService {
  static evaluate(state: GameState): WinEvaluation {
    const mafia = livingMafia(state).length;
    const town = livingTown(state).length;

    if (mafia === 0) {
      return {
        winner: 'TOWN',
        reason:
          town === 0
            ? 'Everyone is dead, but the last Mafia fell with them. The town holds.'
            : 'Every member of the Mafia has been eliminated.',
      };
    }

    if (mafia >= town) {
      return {
        winner: 'MAFIA',
        reason:
          town === 0
            ? 'The Mafia have killed everyone in town.'
            : 'The Mafia now equal the remaining townsfolk. Nobody can out-vote them.',
      };
    }

    return { winner: null, reason: '' };
  }

  static isOver(state: GameState): boolean {
    return WinConditionService.evaluate(state).winner !== null;
  }
}
