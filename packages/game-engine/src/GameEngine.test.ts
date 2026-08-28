import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, GameError, SKIP_VOTE } from '@mafia/shared';
import type { EngineEffect } from './effects';
import { findPlayer } from './state';
import { makeHarness, SIX, startWithRoles, type TestHarness } from './testUtils';

const TOWN_LAYOUT = {
  Alice: 'MAFIA',
  Bob: 'DOCTOR',
  Cara: 'DETECTIVE',
  Dan: 'CIVILIAN',
  Eve: 'CIVILIAN',
  Frank: 'CIVILIAN',
} as const;

function effectKinds(effects: EngineEffect[]): string[] {
  return effects.map((e) => e.kind);
}

// ---------------------------------------------------------------------------

describe('Lobby management', () => {
  let h: TestHarness;
  beforeEach(() => {
    h = makeHarness(SIX);
  });

  it('makes the first player host', () => {
    expect(findPlayer(h.state(), h.id('Alice'))?.isHost).toBe(true);
    expect(h.state().hostId).toBe(h.id('Alice'));
  });

  it('assigns sequential seats', () => {
    expect(h.state().players.map((p) => p.seat)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('rejects a duplicate name regardless of case', () => {
    expect(() => h.engine.addPlayer({ id: 'x', name: 'alice' })).toThrow(GameError);
  });

  it('rejects joining a full room', () => {
    h.engine.updateSettings(h.id('Alice'), { maxPlayers: 6 });
    expect(() => h.engine.addPlayer({ id: 'x', name: 'Grace' })).toThrow(GameError);
  });

  it('refuses to start below the minimum player count', () => {
    const small = makeHarness(['Alice', 'Bob']);
    expect(small.engine.canStart().ok).toBe(false);
    expect(() => small.engine.startGame(small.id('Alice'))).toThrow(GameError);
  });

  it('only lets the host start', () => {
    expect(() => h.engine.startGame(h.id('Bob'))).toThrow(GameError);
    expect(() => h.engine.startGame(h.id('Alice'))).not.toThrow();
  });

  it('only lets the host change settings or kick', () => {
    expect(() => h.engine.updateSettings(h.id('Bob'), { publicVotes: false })).toThrow(GameError);
    expect(() => h.engine.kick(h.id('Bob'), h.id('Cara'))).toThrow(GameError);
  });

  it('lets the host kick a player in the lobby', () => {
    h.engine.kick(h.id('Alice'), h.id('Frank'));
    expect(h.state().players).toHaveLength(5);
  });

  it('stops the host kicking themselves', () => {
    expect(() => h.engine.kick(h.id('Alice'), h.id('Alice'))).toThrow(GameError);
  });

  it('transfers the host and clears the old flag', () => {
    h.engine.transferHost(h.id('Alice'), h.id('Cara'));
    expect(h.state().hostId).toBe(h.id('Cara'));
    expect(h.state().players.filter((p) => p.isHost)).toHaveLength(1);
  });

  it('promotes a new host when the host leaves the lobby', () => {
    h.engine.removePlayer(h.id('Alice'));
    expect(h.state().hostId).not.toBe(h.id('Alice'));
    expect(h.state().players.filter((p) => p.isHost)).toHaveLength(1);
  });

  it('never shrinks capacity below the seated players', () => {
    h.engine.updateSettings(h.id('Alice'), { maxPlayers: 4 });
    expect(h.state().settings.maxPlayers).toBe(6);
  });

  it('clamps out-of-range phase durations', () => {
    h.engine.updateSettings(h.id('Alice'), { durations: { DISCUSSION: 99999 } });
    expect(h.state().settings.durations.DISCUSSION).toBe(600);
  });
});

// ---------------------------------------------------------------------------

describe('Game start and role reveal', () => {
  it('deals exactly one role to every seated player', () => {
    const h = makeHarness(SIX);
    h.engine.startGame(h.id('Alice'));

    expect(h.state().phase).toBe('ROLE_REVEAL');
    expect(h.state().status).toBe('IN_PROGRESS');
    for (const player of h.state().players) {
      expect(player.role).not.toBeNull();
      expect(player.alive).toBe(true);
    }
  });

  it('sets a server-authoritative deadline on the reveal', () => {
    const h = makeHarness(SIX);
    h.engine.startGame(h.id('Alice'));
    const s = h.state();
    expect(s.phaseEndsAt).toBe(
      (s.phaseStartedAt ?? 0) + DEFAULT_SETTINGS.durations.ROLE_REVEAL * 1000,
    );
  });

  it('advances to NIGHT 1 when the reveal timer expires', () => {
    const h = makeHarness(SIX);
    h.engine.startGame(h.id('Alice'));
    h.runPhaseOut();
    expect(h.state().phase).toBe('NIGHT');
    expect(h.state().dayNumber).toBe(1);
  });

  it('does not advance before the timer expires', () => {
    const h = makeHarness(SIX);
    h.engine.startGame(h.id('Alice'));
    h.advance(1000);
    expect(h.state().phase).toBe('ROLE_REVEAL');
  });
});

// ---------------------------------------------------------------------------

describe('Projection security', () => {
  let h: TestHarness;
  beforeEach(() => {
    h = makeHarness(SIX);
    startWithRoles(h, TOWN_LAYOUT);
  });

  it('never puts another player’s role on the wire', () => {
    const view = h.engine.projectFor(h.id('Dan'));
    const serialised = JSON.stringify(view);

    // Dan is a Civilian: no other role should be discoverable anywhere.
    for (const player of view.players) {
      expect(player).not.toHaveProperty('role');
      expect(player.revealedRole).toBeNull();
    }
    expect(view.you.role).toBe('CIVILIAN');
    expect(serialised).not.toContain('"MAFIA"');
    expect(serialised).not.toContain('"DETECTIVE"');
  });

  it('tells each player only their own role', () => {
    expect(h.engine.projectFor(h.id('Alice')).you.role).toBe('MAFIA');
    expect(h.engine.projectFor(h.id('Bob')).you.role).toBe('DOCTOR');
    expect(h.engine.projectFor(h.id('Cara')).you.role).toBe('DETECTIVE');
  });

  it('reveals Mafia partners to Mafia only', () => {
    const eight = makeHarness(['Alice', 'Bob', 'Cara', 'Dan', 'Eve', 'Frank', 'Gina', 'Hank']);
    startWithRoles(eight, {
      Alice: 'MAFIA',
      Bob: 'MAFIA',
      Cara: 'DOCTOR',
      Dan: 'DETECTIVE',
      Eve: 'CIVILIAN',
      Frank: 'CIVILIAN',
      Gina: 'CIVILIAN',
      Hank: 'CIVILIAN',
    });

    expect(eight.engine.projectFor(eight.id('Alice')).you.mafiaAllies).toEqual([
      eight.id('Bob'),
    ]);
    expect(eight.engine.projectFor(eight.id('Cara')).you.mafiaAllies).toEqual([]);
    expect(eight.engine.projectFor(eight.id('Eve')).you.mafiaAllies).toEqual([]);
  });

  it('shows the live Mafia tally to Mafia during the night only', () => {
    h.runPhaseOut(); // -> NIGHT
    h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Dan'));

    expect(
      Object.keys(h.engine.projectFor(h.id('Alice')).you.mafiaTargetVotes),
    ).toHaveLength(1);
    expect(h.engine.projectFor(h.id('Bob')).you.mafiaTargetVotes).toEqual({});

    h.runPhaseOut(); // -> NIGHT_RESOLUTION
    expect(h.engine.projectFor(h.id('Alice')).you.mafiaTargetVotes).toEqual({});
  });

  it('keeps an investigation result private to the Detective', () => {
    h.runPhaseOut(); // -> NIGHT
    h.engine.submitNightAction(h.id('Cara'), 'DETECTIVE_INVESTIGATE', h.id('Alice'));
    h.runPhaseOut(); // -> NIGHT_RESOLUTION
    h.runPhaseOut(); // -> DAY_ANNOUNCEMENT

    const detective = h.engine.projectFor(h.id('Cara'));
    expect(detective.you.investigations).toHaveLength(1);
    expect(detective.you.investigations[0]?.isMafia).toBe(true);

    for (const name of ['Alice', 'Bob', 'Dan', 'Eve', 'Frank']) {
      expect(h.engine.projectFor(h.id(name)).you.investigations).toHaveLength(0);
    }
    // And it must not appear in anyone else's event feed.
    const danEvents = h.engine.projectFor(h.id('Dan')).events;
    expect(danEvents.some((e) => e.type === 'DETECTIVE_INVESTIGATED')).toBe(false);
  });

  it('never ships SERVER-visibility events to anyone', () => {
    h.runPhaseOut();
    h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Dan'));

    for (const name of SIX) {
      const events = h.engine.projectFor(h.id(name)).events;
      expect(events.every((e) => e.visibility !== 'SERVER')).toBe(true);
      expect(events.some((e) => e.type === 'MAFIA_SELECTED_TARGET')).toBe(false);
    }
  });

  it('hides the outcome during NIGHT_RESOLUTION', () => {
    h.runPhaseOut(); // -> NIGHT
    h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Dan'));
    h.runPhaseOut(); // -> NIGHT_RESOLUTION

    // The kill is computed but must not be visible yet.
    expect(h.state().pendingResolution?.killedId).toBe(h.id('Dan'));
    const view = h.engine.projectFor(h.id('Dan'));
    expect(view.players.find((p) => p.id === h.id('Dan'))?.alive).toBe(true);
    expect(view.you.alive).toBe(true);
  });

  it('hides live vote counts when the room uses secret voting', () => {
    const secret = makeHarness(SIX, { publicVotes: false });
    startWithRoles(secret, TOWN_LAYOUT);
    for (let i = 0; i < 4; i++) secret.runPhaseOut(); // -> DISCUSSION
    secret.runPhaseOut(); // -> VOTING
    secret.engine.castVote(secret.id('Alice'), secret.id('Dan'));

    expect(secret.engine.projectFor(secret.id('Bob')).voteTallies).toBeNull();
    secret.runPhaseOut(); // -> VOTE_RESOLUTION
    expect(secret.engine.projectFor(secret.id('Bob')).voteTallies).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('Night into day', () => {
  let h: TestHarness;
  beforeEach(() => {
    h = makeHarness(SIX);
    startWithRoles(h, TOWN_LAYOUT);
    h.runPhaseOut(); // -> NIGHT
  });

  it('kills the Mafia target and announces the death', () => {
    h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Dan'));
    h.runPhaseOut(); // -> NIGHT_RESOLUTION
    h.runPhaseOut(); // -> DAY_ANNOUNCEMENT

    expect(h.alive('Dan')).toBe(false);
    expect(h.state().announcement?.headline).toContain('Dan');
    expect(h.state().announcement?.tone).toBe('DEATH');
  });

  it('reveals the dead player’s role by default', () => {
    h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Dan'));
    h.runPhaseOut();
    h.runPhaseOut();

    const dan = findPlayer(h.state(), h.id('Dan'));
    expect(dan?.revealedRole).toBe('CIVILIAN');
  });

  it('hides the dead player’s role when the room disables reveals', () => {
    const hidden = makeHarness(SIX, { revealRoleOnDeath: false });
    startWithRoles(hidden, TOWN_LAYOUT);
    hidden.runPhaseOut();
    hidden.engine.submitNightAction(hidden.id('Alice'), 'MAFIA_KILL', hidden.id('Dan'));
    hidden.runPhaseOut();
    hidden.runPhaseOut();

    expect(findPlayer(hidden.state(), hidden.id('Dan'))?.revealedRole).toBeNull();
    expect(hidden.alive('Dan')).toBe(false);
  });

  it('produces an identical announcement whether the Doctor saved or the Mafia stalled', () => {
    // Case A: the Doctor blocks the kill.
    h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Dan'));
    h.engine.submitNightAction(h.id('Bob'), 'DOCTOR_PROTECT', h.id('Dan'));
    h.runPhaseOut();
    h.runPhaseOut();
    const saved = h.state().announcement;

    // Case B: the Mafia simply never chose.
    const idle = makeHarness(SIX);
    startWithRoles(idle, TOWN_LAYOUT);
    idle.runPhaseOut();
    idle.runPhaseOut();
    idle.runPhaseOut();
    const quiet = idle.state().announcement;

    expect(saved).toEqual(quiet);
    expect(saved?.headline).toBe('Everyone survived the night.');
  });

  it('does not tell the Doctor their save worked', () => {
    h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Dan'));
    h.engine.submitNightAction(h.id('Bob'), 'DOCTOR_PROTECT', h.id('Dan'));
    h.runPhaseOut();
    h.runPhaseOut();

    const doctorView = h.engine.projectFor(h.id('Bob'));
    expect(JSON.stringify(doctorView)).not.toContain('saved');
    expect(doctorView.events.some((e) => e.type === 'DOCTOR_SAVE_SUCCEEDED')).toBe(false);
  });

  it('clears night selections when a new night begins', () => {
    h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Dan'));
    for (let i = 0; i < 6; i++) h.runPhaseOut(); // through the day, back to NIGHT
    expect(h.state().phase).toBe('NIGHT');
    expect(h.state().night.mafiaVotes).toEqual({});
    expect(h.state().dayNumber).toBe(2);
  });
});

// ---------------------------------------------------------------------------

describe('Action legality', () => {
  let h: TestHarness;
  beforeEach(() => {
    h = makeHarness(SIX);
    startWithRoles(h, TOWN_LAYOUT);
  });

  it('rejects night actions during ROLE_REVEAL', () => {
    expect(() => h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Dan'))).toThrow(
      GameError,
    );
  });

  it('rejects night actions during DISCUSSION', () => {
    for (let i = 0; i < 4; i++) h.runPhaseOut();
    expect(h.state().phase).toBe('DISCUSSION');
    expect(() => h.engine.submitNightAction(h.id('Bob'), 'DOCTOR_PROTECT', h.id('Dan'))).toThrow(
      GameError,
    );
  });

  it('rejects voting outside the voting phase', () => {
    h.runPhaseOut(); // -> NIGHT
    expect(() => h.engine.castVote(h.id('Alice'), h.id('Dan'))).toThrow(GameError);
  });

  it('rejects a dead player voting', () => {
    h.runPhaseOut(); // -> NIGHT
    h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Dan'));
    for (let i = 0; i < 4; i++) h.runPhaseOut(); // -> VOTING
    expect(h.state().phase).toBe('VOTING');
    expect(h.alive('Dan')).toBe(false);
    expect(() => h.engine.castVote(h.id('Dan'), h.id('Alice'))).toThrow(GameError);
  });

  it('rejects a dead player using an ability', () => {
    h.runPhaseOut();
    h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Cara'));
    for (let i = 0; i < 6; i++) h.runPhaseOut(); // back to NIGHT 2
    expect(h.state().phase).toBe('NIGHT');
    expect(h.alive('Cara')).toBe(false);
    expect(() =>
      h.engine.submitNightAction(h.id('Cara'), 'DETECTIVE_INVESTIGATE', h.id('Alice')),
    ).toThrow(GameError);
  });

  it('rejects targeting a dead player', () => {
    h.runPhaseOut();
    h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Dan'));
    for (let i = 0; i < 5; i++) h.runPhaseOut();
    expect(() => h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Dan'))).toThrow(
      GameError,
    );
  });

  it('rejects actions from someone who is not in the room', () => {
    h.runPhaseOut();
    expect(() => h.engine.submitNightAction('ghost', 'MAFIA_KILL', h.id('Dan'))).toThrow(
      GameError,
    );
    expect(() => h.engine.castVote('ghost', h.id('Dan'))).toThrow(GameError);
  });

  it('rejects a skip vote when the room forbids it', () => {
    const strict = makeHarness(SIX, { allowSkipVote: false });
    startWithRoles(strict, TOWN_LAYOUT);
    for (let i = 0; i < 5; i++) strict.runPhaseOut();
    expect(strict.state().phase).toBe('VOTING');
    expect(() => strict.engine.castVote(strict.id('Alice'), SKIP_VOTE)).toThrow(GameError);
  });

  it('lets a late action land right up to the deadline but not after', () => {
    h.runPhaseOut(); // -> NIGHT
    const endsAt = h.state().phaseEndsAt!;
    h.clock.t = endsAt - 1;
    expect(() =>
      h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Dan')),
    ).not.toThrow();

    h.advance(1); // timer fires, phase closes
    expect(h.state().phase).not.toBe('NIGHT');
    expect(() => h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Eve'))).toThrow(
      GameError,
    );
  });
});

// ---------------------------------------------------------------------------

describe('Chat permissions', () => {
  let h: TestHarness;
  beforeEach(() => {
    h = makeHarness(SIX);
  });

  it('allows lobby chat before the game', () => {
    expect(() => h.engine.postChat(h.id('Bob'), 'LOBBY', 'hello')).not.toThrow();
  });

  it('restricts night chat to the Mafia channel', () => {
    startWithRoles(h, TOWN_LAYOUT);
    h.runPhaseOut(); // -> NIGHT

    expect(() => h.engine.postChat(h.id('Alice'), 'MAFIA', 'take Dan')).not.toThrow();
    expect(() => h.engine.postChat(h.id('Dan'), 'DAY', 'anyone there?')).toThrow(GameError);
    expect(() => h.engine.postChat(h.id('Dan'), 'MAFIA', 'let me in')).toThrow(GameError);
  });

  it('keeps Mafia chat out of every other player’s view', () => {
    startWithRoles(h, TOWN_LAYOUT);
    h.runPhaseOut();
    h.engine.postChat(h.id('Alice'), 'MAFIA', 'we take Dan tonight');

    expect(
      h.engine.projectFor(h.id('Alice')).chat.some((m) => m.body.includes('take Dan')),
    ).toBe(true);
    for (const name of ['Bob', 'Cara', 'Dan', 'Eve', 'Frank']) {
      expect(
        h.engine.projectFor(h.id(name)).chat.some((m) => m.channel === 'MAFIA'),
      ).toBe(false);
    }
  });

  it('routes a dead player to the dead channel, not the day channel', () => {
    startWithRoles(h, TOWN_LAYOUT);
    h.runPhaseOut();
    h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Dan'));
    h.runPhaseOut();
    h.runPhaseOut(); // -> DAY_ANNOUNCEMENT, Dan is dead

    expect(() => h.engine.postChat(h.id('Dan'), 'DAY', 'it was Alice!')).toThrow(GameError);
    expect(() => h.engine.postChat(h.id('Dan'), 'DEAD', 'it was Alice!')).not.toThrow();

    // The living must not see the dead channel.
    expect(
      h.engine.projectFor(h.id('Eve')).chat.some((m) => m.channel === 'DEAD'),
    ).toBe(false);
  });

  it('silences the dead entirely when dead chat is disabled', () => {
    const silent = makeHarness(SIX, { deadChatEnabled: false });
    startWithRoles(silent, TOWN_LAYOUT);
    silent.runPhaseOut();
    silent.engine.submitNightAction(silent.id('Alice'), 'MAFIA_KILL', silent.id('Dan'));
    silent.runPhaseOut();
    silent.runPhaseOut();

    expect(() => silent.engine.postChat(silent.id('Dan'), 'DEAD', 'hi')).toThrow(GameError);
  });

  it('rejects an empty message', () => {
    expect(() => h.engine.postChat(h.id('Bob'), 'LOBBY', '   ')).toThrow(GameError);
  });
});

// ---------------------------------------------------------------------------

describe('Win conditions end the game immediately', () => {
  it('ends the moment the last Mafia is voted out', () => {
    const h = makeHarness(SIX);
    startWithRoles(h, TOWN_LAYOUT);
    for (let i = 0; i < 5; i++) h.runPhaseOut(); // -> VOTING
    expect(h.state().phase).toBe('VOTING');

    for (const name of ['Bob', 'Cara', 'Dan', 'Eve']) {
      h.engine.castVote(h.id(name), h.id('Alice'));
    }
    h.runPhaseOut(); // -> VOTE_RESOLUTION, which ends the game

    expect(h.state().phase).toBe('GAME_OVER');
    expect(h.state().result?.winner).toBe('TOWN');
    expect(h.alive('Alice')).toBe(false);
  });

  it('ends when the Mafia reach parity after a night kill', () => {
    const h = makeHarness(SIX);
    startWithRoles(h, TOWN_LAYOUT);
    // Reduce the town to two before the kill: Mafia 1 vs Town 2.
    for (const name of ['Eve', 'Frank', 'Cara']) {
      const p = findPlayer(h.state(), h.id(name))!;
      p.alive = false;
      p.diedOnDay = 0;
    }
    h.runPhaseOut(); // -> NIGHT
    h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Dan'));
    h.runPhaseOut(); // -> NIGHT_RESOLUTION
    h.runPhaseOut(); // -> DAY_ANNOUNCEMENT applies the kill: 1 vs 1

    expect(h.state().phase).toBe('GAME_OVER');
    expect(h.state().result?.winner).toBe('MAFIA');
  });

  it('reveals every role in the final result', () => {
    const h = makeHarness(SIX);
    startWithRoles(h, TOWN_LAYOUT);
    h.engine.endGameEarly(h.id('Alice'));

    const roster = h.state().result?.roster ?? [];
    expect(roster).toHaveLength(6);
    expect(roster.find((r) => r.name === 'Alice')?.role).toBe('MAFIA');
    expect(roster.find((r) => r.name === 'Bob')?.team).toBe('TOWN');

    // And now the public projection may carry roles.
    const view = h.engine.projectFor(h.id('Dan'));
    expect(view.players.every((p) => p.revealedRole !== null)).toBe(true);
    expect(view.result).not.toBeNull();
  });

  it('stops the clock at game over', () => {
    const h = makeHarness(SIX);
    startWithRoles(h, TOWN_LAYOUT);
    h.engine.endGameEarly(h.id('Alice'));
    expect(h.state().phaseEndsAt).toBeNull();
    h.advance(100_000);
    expect(h.state().phase).toBe('GAME_OVER');
  });

  it('only lets the host end the game early', () => {
    const h = makeHarness(SIX);
    startWithRoles(h, TOWN_LAYOUT);
    expect(() => h.engine.endGameEarly(h.id('Bob'))).toThrow(GameError);
  });
});

// ---------------------------------------------------------------------------

describe('Disconnection and reconnection', () => {
  let h: TestHarness;
  beforeEach(() => {
    h = makeHarness(SIX);
    startWithRoles(h, TOWN_LAYOUT);
  });

  it('marks a player disconnected without changing their role or life', () => {
    h.engine.setConnected(h.id('Cara'), false);
    const cara = findPlayer(h.state(), h.id('Cara'))!;
    expect(cara.connected).toBe(false);
    expect(cara.alive).toBe(true);
    expect(cara.role).toBe('DETECTIVE');
  });

  it('restores the same role on reconnect — never a new one', () => {
    const before = h.roleOf('Cara');
    h.engine.setConnected(h.id('Cara'), false);
    h.engine.setConnected(h.id('Cara'), true);
    expect(h.roleOf('Cara')).toBe(before);

    // Re-adding the same id is treated as a reconnect, not a fresh seat.
    h.engine.addPlayer({ id: h.id('Cara'), name: 'Cara' });
    expect(h.roleOf('Cara')).toBe(before);
    expect(h.state().players).toHaveLength(6);
  });

  it('keeps a disconnected player in the game by default', () => {
    h.engine.setConnected(h.id('Eve'), false);
    h.engine.handleReconnectTimeout(h.id('Eve'));
    expect(h.alive('Eve')).toBe(true);
  });

  it('eliminates an abandoned player when the room is configured that way', () => {
    const strict = makeHarness(SIX, { disconnectPolicy: 'ELIMINATE' });
    startWithRoles(strict, TOWN_LAYOUT);
    strict.engine.setConnected(strict.id('Eve'), false);
    strict.engine.handleReconnectTimeout(strict.id('Eve'));
    expect(strict.alive('Eve')).toBe(false);
  });

  it('drops a lobby player who never comes back', () => {
    const lobby = makeHarness(SIX);
    lobby.engine.setConnected(lobby.id('Frank'), false);
    lobby.engine.handleReconnectTimeout(lobby.id('Frank'));
    expect(lobby.state().players).toHaveLength(5);
  });

  it('skips a disconnected player’s vote rather than stalling', () => {
    for (let i = 0; i < 5; i++) h.runPhaseOut(); // -> VOTING
    h.engine.setConnected(h.id('Frank'), false);
    h.engine.castVote(h.id('Alice'), h.id('Dan'));
    h.engine.castVote(h.id('Bob'), h.id('Dan'));
    h.runPhaseOut();
    expect(h.alive('Dan')).toBe(false);
  });

  it('hands the room to someone else when the host dies mid-game', () => {
    h.runPhaseOut(); // -> NIGHT
    // Alice (host, Mafia) is voted out later; simulate her death directly.
    h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Dan'));
    for (let i = 0; i < 4; i++) h.runPhaseOut(); // -> VOTING
    for (const name of ['Bob', 'Cara', 'Eve']) h.engine.castVote(h.id(name), h.id('Alice'));
    h.runPhaseOut();

    expect(h.state().hostId).not.toBe(h.id('Alice'));
    expect(h.state().players.filter((p) => p.isHost)).toHaveLength(1);
  });

  it('treats leaving mid-game as a disconnect, keeping the seat', () => {
    h.engine.removePlayer(h.id('Eve'));
    expect(h.state().players).toHaveLength(6);
    expect(findPlayer(h.state(), h.id('Eve'))?.connected).toBe(false);
  });

  it('survives every player disconnecting at once', () => {
    for (const name of SIX) h.engine.setConnected(h.id(name), false);
    expect(() => {
      for (let i = 0; i < 6; i++) h.runPhaseOut();
    }).not.toThrow();
    expect(h.state().players).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------

describe('State recovery after a refresh', () => {
  it('serves an accurate timer regardless of when the client asks', () => {
    const h = makeHarness(SIX);
    startWithRoles(h, TOWN_LAYOUT);
    h.runPhaseOut(); // -> NIGHT

    const endsAt = h.state().phaseEndsAt!;
    h.clock.t += 12_000; // the player was away for 12 seconds

    const view = h.engine.projectFor(h.id('Dan'));
    expect(view.phaseEndsAt).toBe(endsAt);
    expect(view.serverTime).toBe(h.clock.t);
    // The client derives the countdown from these two numbers.
    expect(view.phaseEndsAt! - view.serverTime).toBe(
      DEFAULT_SETTINGS.durations.NIGHT * 1000 - 12_000,
    );
  });

  it('returns the full personal state after a mid-night reconnect', () => {
    const h = makeHarness(SIX);
    startWithRoles(h, TOWN_LAYOUT);
    h.runPhaseOut();
    h.engine.submitNightAction(h.id('Cara'), 'DETECTIVE_INVESTIGATE', h.id('Alice'));

    h.engine.setConnected(h.id('Cara'), false);
    h.engine.setConnected(h.id('Cara'), true);

    const view = h.engine.projectFor(h.id('Cara'));
    expect(view.you.role).toBe('DETECTIVE');
    expect(view.you.alive).toBe(true);
    expect(view.phase).toBe('NIGHT');
    // Their pending selection survived the round trip.
    expect(view.you.pendingNightTarget).toBe(h.id('Alice'));
  });

  it('is fully restorable from a serialised snapshot', () => {
    const h = makeHarness(SIX);
    startWithRoles(h, TOWN_LAYOUT);
    h.runPhaseOut();
    h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Dan'));

    const snapshot = JSON.parse(JSON.stringify(h.state()));
    h.engine.restore(snapshot);

    expect(h.engine.projectFor(h.id('Alice')).you.pendingNightTarget).toBe(h.id('Dan'));
    h.runPhaseOut();
    h.runPhaseOut();
    expect(h.alive('Dan')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('Rematch', () => {
  function finishedGame() {
    const h = makeHarness(SIX);
    startWithRoles(h, TOWN_LAYOUT);
    h.engine.endGameEarly(h.id('Alice'));
    expect(h.state().phase).toBe('GAME_OVER');
    return h;
  }

  it('needs a majority before restarting', () => {
    const h = finishedGame();
    h.engine.voteRematch(h.id('Alice'), true);
    h.engine.voteRematch(h.id('Bob'), true);
    expect(h.state().phase).toBe('GAME_OVER');

    h.engine.voteRematch(h.id('Cara'), true);
    expect(h.state().phase).toBe('LOBBY');
  });

  it('wipes deaths, roles, votes and history on reset', () => {
    const h = finishedGame();
    for (const name of ['Alice', 'Bob', 'Cara']) h.engine.voteRematch(h.id(name), true);

    const s = h.state();
    expect(s.phase).toBe('LOBBY');
    expect(s.status).toBe('LOBBY');
    expect(s.dayNumber).toBe(0);
    expect(s.votes).toEqual({});
    expect(s.investigations).toEqual({});
    expect(s.doctorHistory).toEqual({});
    expect(s.result).toBeNull();
    for (const p of s.players) {
      expect(p.role).toBeNull();
      expect(p.revealedRole).toBeNull();
      expect(p.alive).toBe(true);
      expect(p.rematchVote).toBe(false);
    }
  });

  it('seats spectators for the next game', () => {
    const h = makeHarness(SIX);
    startWithRoles(h, TOWN_LAYOUT);
    h.engine.addPlayer({ id: 'late', name: 'Grace' });
    expect(findPlayer(h.state(), 'late')?.isSpectator).toBe(true);

    h.engine.endGameEarly(h.id('Alice'));
    for (const name of ['Alice', 'Bob', 'Cara']) h.engine.voteRematch(h.id(name), true);

    expect(findPlayer(h.state(), 'late')?.isSpectator).toBe(false);
    expect(h.engine.canStart().ok).toBe(true);
  });

  it('can play a second full game after a rematch', () => {
    const h = finishedGame();
    for (const name of ['Alice', 'Bob', 'Cara']) h.engine.voteRematch(h.id(name), true);

    h.engine.startGame(h.state().hostId);
    expect(h.state().phase).toBe('ROLE_REVEAL');
    for (const p of h.state().players) expect(p.role).not.toBeNull();

    h.runPhaseOut();
    expect(h.state().phase).toBe('NIGHT');
    expect(h.state().dayNumber).toBe(1);
  });

  it('rejects rematch votes outside GAME_OVER', () => {
    const h = makeHarness(SIX);
    expect(() => h.engine.voteRematch(h.id('Alice'), true)).toThrow(GameError);
  });
});

// ---------------------------------------------------------------------------

describe('Spectators', () => {
  it('seats a mid-game joiner as a spectator', () => {
    const h = makeHarness(SIX);
    startWithRoles(h, TOWN_LAYOUT);
    h.engine.addPlayer({ id: 'late', name: 'Grace' });

    const spectator = findPlayer(h.state(), 'late')!;
    expect(spectator.isSpectator).toBe(true);
    expect(spectator.alive).toBe(false);
  });

  it('refuses a mid-game joiner when spectating is off', () => {
    const closed = makeHarness(SIX, { allowSpectators: false });
    startWithRoles(closed, TOWN_LAYOUT);
    expect(() => closed.engine.addPlayer({ id: 'late', name: 'Grace' })).toThrow(GameError);
  });

  it('gives a spectator no role and no abilities', () => {
    const h = makeHarness(SIX);
    startWithRoles(h, TOWN_LAYOUT);
    h.engine.addPlayer({ id: 'late', name: 'Grace' });
    h.runPhaseOut(); // -> NIGHT

    const view = h.engine.projectFor('late');
    expect(view.you.role).toBeNull();
    expect(view.you.isSpectator).toBe(true);
    expect(view.players.every((p) => p.revealedRole === null)).toBe(true);

    expect(() => h.engine.submitNightAction('late', 'MAFIA_KILL', h.id('Dan'))).toThrow(
      GameError,
    );
  });

  it('does not count a spectator toward the win condition', () => {
    const h = makeHarness(SIX);
    startWithRoles(h, TOWN_LAYOUT);
    h.engine.addPlayer({ id: 'late', name: 'Grace' });
    for (let i = 0; i < 5; i++) h.runPhaseOut(); // -> VOTING
    for (const name of ['Bob', 'Cara', 'Dan', 'Eve']) {
      h.engine.castVote(h.id(name), h.id('Alice'));
    }
    h.runPhaseOut();
    expect(h.state().result?.winner).toBe('TOWN');
  });
});

// ---------------------------------------------------------------------------

describe('Effects contract', () => {
  it('reports a phase change and a death when a night kill lands', () => {
    const h = makeHarness(SIX);
    startWithRoles(h, TOWN_LAYOUT);
    h.runPhaseOut(); // -> NIGHT
    h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Dan'));
    h.runPhaseOut(); // -> NIGHT_RESOLUTION

    h.clock.t = h.state().phaseEndsAt!;
    const effects = h.engine.tick(h.clock.t);

    expect(effectKinds(effects)).toEqual(
      expect.arrayContaining(['PLAYER_DIED', 'ANNOUNCEMENT', 'PHASE_CHANGED']),
    );
    const died = effects.find((e) => e.kind === 'PLAYER_DIED');
    expect(died && died.kind === 'PLAYER_DIED' && died.payload.playerName).toBe('Dan');
  });

  it('emits GAME_OVER exactly once when a side wins', () => {
    const h = makeHarness(SIX);
    startWithRoles(h, TOWN_LAYOUT);
    for (let i = 0; i < 5; i++) h.runPhaseOut();
    for (const name of ['Bob', 'Cara', 'Dan', 'Eve']) {
      h.engine.castVote(h.id(name), h.id('Alice'));
    }
    h.clock.t = h.state().phaseEndsAt!;
    const effects = h.engine.tick(h.clock.t);

    expect(effects.filter((e) => e.kind === 'GAME_OVER')).toHaveLength(1);
  });

  it('detects when every night action is in', () => {
    const h = makeHarness(SIX);
    startWithRoles(h, TOWN_LAYOUT);
    h.runPhaseOut();

    expect(h.engine.allNightActionsSubmitted()).toBe(false);
    h.engine.submitNightAction(h.id('Alice'), 'MAFIA_KILL', h.id('Dan'));
    h.engine.submitNightAction(h.id('Bob'), 'DOCTOR_PROTECT', h.id('Eve'));
    expect(h.engine.allNightActionsSubmitted()).toBe(false);
    h.engine.submitNightAction(h.id('Cara'), 'DETECTIVE_INVESTIGATE', h.id('Alice'));
    expect(h.engine.allNightActionsSubmitted()).toBe(true);
  });
});
