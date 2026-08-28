import type {
  AnnouncementPayload,
  ChatMessage,
  GameEvent,
  GameResult,
  Phase,
  PlayerDiedPayload,
  PrivateResultPayload,
} from '@mafia/shared';

/**
 * The engine never touches a socket. It returns a list of effects describing
 * what the outside world should be told; the server translates them into
 * emits. This keeps the engine fully testable without any transport.
 */
export type EngineEffect =
  | { kind: 'PHASE_CHANGED'; from: Phase; to: Phase; dayNumber: number }
  | { kind: 'STATE_DIRTY' }
  | { kind: 'GAME_STARTED'; dayNumber: number }
  | { kind: 'PLAYER_DIED'; payload: PlayerDiedPayload }
  | { kind: 'ANNOUNCEMENT'; payload: AnnouncementPayload }
  | { kind: 'PRIVATE_RESULT'; playerId: string; payload: PrivateResultPayload }
  | { kind: 'CHAT'; message: ChatMessage }
  | { kind: 'EVENT'; event: GameEvent }
  | { kind: 'VOTE_UPDATED' }
  | { kind: 'GAME_OVER'; result: GameResult }
  | { kind: 'GAME_RESET' }
  | { kind: 'PLAYER_JOINED'; playerId: string }
  | { kind: 'PLAYER_LEFT'; playerId: string; name: string }
  | { kind: 'ROOM_CLOSED'; reason: string };

/** Small accumulator so engine methods can push effects without ceremony. */
export class EffectCollector {
  private readonly effects: EngineEffect[] = [];

  push(effect: EngineEffect): void {
    this.effects.push(effect);
  }

  pushAll(effects: readonly EngineEffect[]): void {
    for (const e of effects) this.effects.push(e);
  }

  drain(): EngineEffect[] {
    return this.effects.splice(0, this.effects.length);
  }

  get length(): number {
    return this.effects.length;
  }
}
