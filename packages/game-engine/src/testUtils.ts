import type { GameSettingsPatch, Role } from '@mafia/shared';
import { GameEngine } from './GameEngine';
import { seededRng } from './rng';
import { findPlayer, type GameState } from './state';

export interface TestHarness {
  engine: GameEngine;
  clock: { t: number };
  /** Advance the fake clock by `ms` and run the engine's timer tick. */
  advance(ms: number): void;
  /** Jump straight to the end of the current phase. */
  runPhaseOut(): void;
  id(name: string): string;
  state(): GameState;
  setRoles(roles: Record<string, Role>): void;
  roleOf(name: string): Role | null;
  alive(name: string): boolean;
}

export const START_TIME = 1_700_000_000_000;

/**
 * Builds a deterministic engine seeded with named players. Ids are derived
 * from names so tests can read as prose.
 */
export function makeHarness(
  names: string[],
  settings: GameSettingsPatch = {},
  seed = 1234,
): TestHarness {
  const clock = { t: START_TIME };
  let counter = 0;

  const engine = GameEngine.create(
    { roomCode: 'TEST01', roomName: 'Test Room', hostId: '', settings },
    {
      rng: seededRng(seed),
      now: () => clock.t,
      newId: () => `evt-${counter++}`,
    },
  );

  const id = (name: string) => `player-${name.toLowerCase()}`;

  for (const name of names) {
    engine.addPlayer({ id: id(name), name });
  }

  const harness: TestHarness = {
    engine,
    clock,
    id,
    state: () => engine.getState(),
    advance(ms: number) {
      clock.t += ms;
      engine.tick(clock.t);
    },
    runPhaseOut() {
      const endsAt = engine.getState().phaseEndsAt;
      if (endsAt === null) return;
      clock.t = endsAt;
      engine.tick(clock.t);
    },
    setRoles(roles: Record<string, Role>) {
      for (const [name, role] of Object.entries(roles)) {
        const player = findPlayer(engine.getState(), id(name));
        if (!player) throw new Error(`No such player: ${name}`);
        player.role = role;
      }
    },
    roleOf(name: string) {
      return findPlayer(engine.getState(), id(name))?.role ?? null;
    },
    alive(name: string) {
      return findPlayer(engine.getState(), id(name))?.alive ?? false;
    },
  };

  return harness;
}

/** Six players is the recommended minimum and the default test table. */
export const SIX = ['Alice', 'Bob', 'Cara', 'Dan', 'Eve', 'Frank'];

/**
 * Starts a game and overwrites the dealt roles with a fixed layout, so tests
 * can assert on scenarios rather than on the shuffle.
 */
export function startWithRoles(
  harness: TestHarness,
  roles: Record<string, Role>,
  hostName = 'Alice',
): void {
  harness.engine.startGame(harness.id(hostName));
  harness.setRoles(roles);
}
