import { describe, expect, it } from 'vitest';
import type { Role } from '@mafia/shared';
import { WinConditionService } from './WinConditionService';
import { createGameState, type EnginePlayer, type GameState } from './state';

/** Builds a bare state populated with players of the given roles. */
function stateWith(roster: Array<{ role: Role; alive: boolean }>): GameState {
  const state = createGameState({
    roomCode: 'AAA111',
    roomName: 'T',
    hostId: 'p0',
    now: 0,
  });
  state.players = roster.map((entry, i): EnginePlayer => ({
    id: `p${i}`,
    name: `P${i}`,
    seat: i + 1,
    isHost: i === 0,
    isSpectator: false,
    ready: true,
    role: entry.role,
    alive: entry.alive,
    connected: true,
    disconnectedAt: null,
    diedOnDay: entry.alive ? null : 1,
    revealedRole: null,
    rematchVote: false,
    joinedAt: 0,
  }));
  return state;
}

const alive = (role: Role) => ({ role, alive: true });
const dead = (role: Role) => ({ role, alive: false });

describe('WinConditionService', () => {
  it('has no winner while the Mafia are outnumbered', () => {
    const state = stateWith([
      alive('MAFIA'),
      alive('DOCTOR'),
      alive('DETECTIVE'),
      alive('CIVILIAN'),
    ]);
    expect(WinConditionService.evaluate(state).winner).toBeNull();
  });

  it('gives the town the win when the last Mafia dies', () => {
    const state = stateWith([dead('MAFIA'), alive('DOCTOR'), alive('CIVILIAN')]);
    expect(WinConditionService.evaluate(state).winner).toBe('TOWN');
  });

  it('gives the Mafia the win at parity (2 Mafia vs 2 town)', () => {
    const state = stateWith([
      alive('MAFIA'),
      alive('MAFIA'),
      alive('CIVILIAN'),
      alive('DOCTOR'),
      dead('CIVILIAN'),
      dead('DETECTIVE'),
    ]);
    expect(WinConditionService.evaluate(state).winner).toBe('MAFIA');
  });

  it('gives the Mafia the win when they outnumber the town', () => {
    const state = stateWith([alive('MAFIA'), alive('MAFIA'), alive('CIVILIAN')]);
    expect(WinConditionService.evaluate(state).winner).toBe('MAFIA');
  });

  it('gives the Mafia the win at 1 vs 1', () => {
    const state = stateWith([alive('MAFIA'), alive('CIVILIAN'), dead('DOCTOR')]);
    expect(WinConditionService.evaluate(state).winner).toBe('MAFIA');
  });

  it('does not end at 1 Mafia vs 2 town', () => {
    const state = stateWith([alive('MAFIA'), alive('CIVILIAN'), alive('DOCTOR')]);
    expect(WinConditionService.evaluate(state).winner).toBeNull();
  });

  it('prefers a town win when everyone is dead', () => {
    const state = stateWith([dead('MAFIA'), dead('CIVILIAN')]);
    expect(WinConditionService.evaluate(state).winner).toBe('TOWN');
  });

  it('ignores spectators when counting', () => {
    const state = stateWith([alive('MAFIA'), alive('CIVILIAN'), alive('DOCTOR')]);
    // A watching spectator must not tip the balance.
    state.players.push({
      id: 'spec',
      name: 'Spec',
      seat: 0,
      isHost: false,
      isSpectator: true,
      ready: false,
      role: null,
      alive: true,
      connected: true,
      disconnectedAt: null,
      diedOnDay: null,
      revealedRole: null,
      rematchVote: false,
      joinedAt: 0,
    });
    expect(WinConditionService.evaluate(state).winner).toBeNull();
  });
});
