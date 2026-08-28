import {
  GameError,
  ROLE_DEFINITIONS,
  SKIP_VOTE,
  sanitizeSettings,
  teamOf,
  type ChatChannel,
  type ChatMessage,
  type GameEvent,
  type GameEventType,
  type GameEventVisibility,
  type GameResult,
  type GameSettingsPatch,
  type NightActionType,
  type Phase,
  type Role,
  type VoteTarget,
} from '@mafia/shared';

import { EffectCollector, type EngineEffect } from './effects';
import { GameStateMachine } from './GameStateMachine';
import { NightResolutionService } from './NightResolutionService';
import { ProjectionService, requiredRematchVotes, writableChannel } from './projection';
import { RoleAssignmentService, type RoleAssignment } from './RoleAssignmentService';
import { VotingService } from './VotingService';
import { WinConditionService } from './WinConditionService';
import { cryptoRng, type Rng } from './rng';
import {
  createGameState,
  emptyNightState,
  findPlayer,
  livingPlayers,
  mafiaMembers,
  seatedPlayers,
  type EnginePlayer,
  type GameState,
} from './state';

const MAX_CHAT_HISTORY = 400;
const MAX_EVENT_HISTORY = 400;

export interface EngineDeps {
  rng?: Rng;
  now?: () => number;
  newId?: () => string;
}

export interface AddPlayerParams {
  id: string;
  name: string;
  isSpectator?: boolean;
}

/**
 * Owns one room's authoritative state and every legal mutation of it.
 *
 * Every public method either mutates state and returns the effects the server
 * should broadcast, or throws a `GameError` whose code maps to safe,
 * player-facing copy. There is no I/O here at all, which is what makes the
 * entire ruleset testable in isolation.
 */
export class GameEngine {
  private state: GameState;
  private readonly rng: Rng;
  private readonly nowFn: () => number;
  private readonly newId: () => string;
  /** Retained across a rematch so roles are never dealt identically twice. */
  private lastAssignment: RoleAssignment | null = null;

  constructor(state: GameState, deps: EngineDeps = {}) {
    this.state = state;
    this.rng = deps.rng ?? cryptoRng;
    this.nowFn = deps.now ?? (() => Date.now());
    this.newId =
      deps.newId ??
      (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  }

  static create(
    params: { roomCode: string; roomName: string; hostId: string; settings?: GameSettingsPatch },
    deps: EngineDeps = {},
  ): GameEngine {
    const now = deps.now?.() ?? Date.now();
    return new GameEngine(createGameState({ ...params, now }), deps);
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  getState(): GameState {
    return this.state;
  }

  /** Replace state wholesale — used when rehydrating from Redis/Postgres. */
  restore(state: GameState): void {
    this.state = state;
  }

  get phase(): Phase {
    return this.state.phase;
  }

  get roomCode(): string {
    return this.state.roomCode;
  }

  projectFor(playerId: string) {
    return ProjectionService.forPlayer(this.state, playerId, this.now());
  }

  private now(): number {
    return this.nowFn();
  }

  private touch(): void {
    this.state.updatedAt = this.now();
  }

  // -------------------------------------------------------------------------
  // Roster
  // -------------------------------------------------------------------------

  addPlayer(params: AddPlayerParams): EngineEffect[] {
    const fx = new EffectCollector();
    const s = this.state;

    // A cancelled room is gone for everyone.
    if (s.status === 'CANCELLED') throw new GameError('ROOM_CLOSED', 410);

    const existing = findPlayer(s, params.id);
    if (existing) {
      // Idempotent: a reconnect for a known player is not a new seat. This is
      // checked before any status gate, so a player can always return — including
      // to a finished game, to see the reveal and vote on a rematch.
      return this.setConnected(params.id, true);
    }

    const normalized = params.name.trim();
    const nameClash = s.players.some(
      (p) => p.name.toLowerCase() === normalized.toLowerCase(),
    );
    if (nameClash) throw new GameError('NAME_TAKEN', 409);

    // Anyone arriving mid-game can only ever be a spectator.
    const mustSpectate = s.phase !== 'LOBBY';
    if (mustSpectate && !s.settings.allowSpectators) {
      throw new GameError('GAME_ALREADY_STARTED', 409);
    }
    const isSpectator = params.isSpectator === true || mustSpectate;

    if (!isSpectator && seatedPlayers(s).length >= s.settings.maxPlayers) {
      throw new GameError('ROOM_FULL', 409);
    }

    const player: EnginePlayer = {
      id: params.id,
      name: normalized,
      seat: isSpectator ? 0 : s.nextSeat++,
      isHost: false,
      isSpectator,
      ready: false,
      role: null,
      alive: !isSpectator,
      connected: true,
      disconnectedAt: null,
      diedOnDay: null,
      revealedRole: null,
      rematchVote: false,
      joinedAt: this.now(),
    };
    s.players.push(player);

    // The first seated arrival owns the room.
    if (!isSpectator && !s.players.some((p) => p.isHost)) {
      player.isHost = true;
      s.hostId = player.id;
    }

    fx.push({ kind: 'PLAYER_JOINED', playerId: player.id });
    fx.push(
      this.recordEvent(
        'PLAYER_RECONNECTED',
        'PUBLIC',
        isSpectator
          ? `${player.name} is now spectating.`
          : `${player.name} joined the room.`,
      ),
    );
    fx.push({ kind: 'STATE_DIRTY' });
    this.touch();
    return fx.drain();
  }

  /** Hard removal. Only legal in the lobby; mid-game this becomes a disconnect. */
  removePlayer(playerId: string): EngineEffect[] {
    const fx = new EffectCollector();
    const s = this.state;
    const player = findPlayer(s, playerId);
    if (!player) return [];

    if (s.phase !== 'LOBBY' && !player.isSpectator) {
      return this.setConnected(playerId, false);
    }

    s.players = s.players.filter((p) => p.id !== playerId);
    fx.push({ kind: 'PLAYER_LEFT', playerId, name: player.name });
    fx.push(this.recordEvent('PLAYER_LEFT', 'PUBLIC', `${player.name} left the room.`));

    if (player.isHost) fx.pushAll(this.promoteNewHost());
    fx.push({ kind: 'STATE_DIRTY' });
    this.touch();
    return fx.drain();
  }

  setConnected(playerId: string, connected: boolean): EngineEffect[] {
    const fx = new EffectCollector();
    const player = findPlayer(this.state, playerId);
    if (!player) return [];
    if (player.connected === connected) {
      // Still emit a state refresh so the reconnecting socket gets a snapshot.
      return [{ kind: 'STATE_DIRTY' }];
    }

    player.connected = connected;
    player.disconnectedAt = connected ? null : this.now();

    fx.push(
      this.recordEvent(
        connected ? 'PLAYER_RECONNECTED' : 'PLAYER_DISCONNECTED',
        'PUBLIC',
        connected ? `${player.name} reconnected.` : `${player.name} lost connection.`,
      ),
    );

    // The room should never be left without a host.
    if (!connected && player.isHost && this.state.phase === 'LOBBY') {
      fx.pushAll(this.promoteNewHost());
    }

    fx.push({ kind: 'STATE_DIRTY' });
    this.touch();
    return fx.drain();
  }

  /**
   * Called once the reconnect grace window has elapsed. What happens next is
   * a room setting: by default the player simply stays inactive.
   */
  handleReconnectTimeout(playerId: string): EngineEffect[] {
    const s = this.state;
    const player = findPlayer(s, playerId);
    if (!player || player.connected) return [];

    if (s.phase === 'LOBBY') return this.removePlayer(playerId);

    if (s.settings.disconnectPolicy === 'ELIMINATE' && player.alive && !player.isSpectator) {
      const fx = new EffectCollector();
      fx.pushAll(this.killPlayer(player, 'DISCONNECT'));
      fx.pushAll(this.endGameIfWon());
      fx.push({ kind: 'STATE_DIRTY' });
      this.touch();
      return fx.drain();
    }

    return [];
  }

  setReady(playerId: string, ready: boolean): EngineEffect[] {
    this.assertPhase('LOBBY');
    const player = this.requirePlayer(playerId);
    if (player.isSpectator) throw new GameError('SPECTATORS_CANNOT_ACT', 403);
    player.ready = ready;
    this.touch();
    return [{ kind: 'STATE_DIRTY' }];
  }

  transferHost(requesterId: string, targetId: string): EngineEffect[] {
    this.requireHost(requesterId);
    const target = this.requirePlayer(targetId);
    if (target.isSpectator) throw new GameError('INVALID_TARGET', 400);

    for (const p of this.state.players) p.isHost = p.id === targetId;
    this.state.hostId = targetId;
    this.touch();

    return [
      this.recordEvent('HOST_TRANSFERRED', 'PUBLIC', `${target.name} is now the host.`),
      { kind: 'STATE_DIRTY' },
    ];
  }

  kick(requesterId: string, targetId: string): EngineEffect[] {
    this.requireHost(requesterId);
    this.assertPhase('LOBBY');
    if (requesterId === targetId) throw new GameError('INVALID_TARGET', 400);
    this.requirePlayer(targetId);
    return this.removePlayer(targetId);
  }

  updateSettings(requesterId: string, patch: GameSettingsPatch): EngineEffect[] {
    this.requireHost(requesterId);
    this.assertPhase('LOBBY');

    const next = sanitizeSettings(this.state.settings, patch);
    // Never shrink capacity below the people already sitting down.
    const seated = seatedPlayers(this.state).length;
    if (next.maxPlayers < seated) next.maxPlayers = seated;
    if (next.minPlayers > next.maxPlayers) next.minPlayers = next.maxPlayers;

    this.state.settings = next;
    this.touch();
    return [{ kind: 'STATE_DIRTY' }];
  }

  cancelRoom(requesterId: string): EngineEffect[] {
    this.requireHost(requesterId);
    this.state.status = 'CANCELLED';
    this.touch();
    return [{ kind: 'ROOM_CLOSED', reason: 'The host closed this room.' }];
  }

  private promoteNewHost(): EngineEffect[] {
    const s = this.state;
    const candidates = seatedPlayers(s)
      .filter((p) => p.alive || s.phase === 'LOBBY')
      .sort((a, b) => Number(b.connected) - Number(a.connected) || a.seat - b.seat);

    const next = candidates[0] ?? seatedPlayers(s)[0];
    if (!next) return [];

    for (const p of s.players) p.isHost = p.id === next.id;
    s.hostId = next.id;
    return [
      this.recordEvent('HOST_TRANSFERRED', 'PUBLIC', `${next.name} is now the host.`),
    ];
  }

  // -------------------------------------------------------------------------
  // Starting the game
  // -------------------------------------------------------------------------

  canStart(): { ok: boolean; reason?: string } {
    const s = this.state;
    if (s.phase !== 'LOBBY') return { ok: false, reason: 'The game has already started.' };
    const seated = seatedPlayers(s).length;
    if (seated < s.settings.minPlayers) {
      return { ok: false, reason: `Need at least ${s.settings.minPlayers} players.` };
    }
    return { ok: true };
  }

  startGame(requesterId: string): EngineEffect[] {
    this.requireHost(requesterId);
    const check = this.canStart();
    if (!check.ok) throw new GameError('NOT_ENOUGH_PLAYERS', 409);
    return this.enterPhase('ROLE_REVEAL');
  }

  // -------------------------------------------------------------------------
  // Night actions
  // -------------------------------------------------------------------------

  submitNightAction(
    playerId: string,
    action: NightActionType,
    targetId: string | null,
  ): EngineEffect[] {
    const s = this.state;
    const actor = this.requirePlayer(playerId);

    if (s.phase !== 'NIGHT') throw new GameError('INVALID_PHASE', 409);
    if (actor.isSpectator) throw new GameError('SPECTATORS_CANNOT_ACT', 403);
    if (!actor.alive) throw new GameError('NOT_ALIVE', 403);
    if (!actor.role) throw new GameError('INVALID_PHASE', 409);

    const definition = ROLE_DEFINITIONS[actor.role];
    if (definition.nightAction !== action) throw new GameError('INVALID_ROLE_FOR_ACTION', 403);

    // A null target retracts a pending selection.
    if (targetId === null) {
      this.clearNightAction(actor, action);
      this.touch();
      return [{ kind: 'STATE_DIRTY' }];
    }

    const target = findPlayer(s, targetId);
    if (!target || !target.alive || target.isSpectator) {
      throw new GameError('INVALID_TARGET', 400);
    }

    switch (action) {
      case 'MAFIA_KILL': {
        // The Mafia cannot turn on their own, including themselves.
        if (target.role === 'MAFIA') throw new GameError('INVALID_TARGET', 400);
        s.night.mafiaVotes[actor.id] = target.id;
        break;
      }
      case 'DOCTOR_PROTECT': {
        const verdict = NightResolutionService.canDoctorProtect(s, actor.id, target.id);
        if (!verdict.allowed) throw new GameError('INVALID_TARGET', 400, verdict.reason);
        s.night.doctorProtect = { actorId: actor.id, targetId: target.id };
        break;
      }
      case 'DETECTIVE_INVESTIGATE': {
        // Investigating yourself tells you nothing you don't already know.
        if (target.id === actor.id) throw new GameError('INVALID_TARGET', 400);
        s.night.detectiveInvestigate = { actorId: actor.id, targetId: target.id };
        break;
      }
    }

    this.recordEvent(
      action === 'MAFIA_KILL'
        ? 'MAFIA_SELECTED_TARGET'
        : action === 'DOCTOR_PROTECT'
          ? 'DOCTOR_PROTECTED'
          : 'DETECTIVE_INVESTIGATED',
      'SERVER',
      `${actor.name} -> ${target.name}`,
    );

    this.touch();
    return [{ kind: 'STATE_DIRTY' }];
  }

  private clearNightAction(actor: EnginePlayer, action: NightActionType): void {
    const night = this.state.night;
    if (action === 'MAFIA_KILL') delete night.mafiaVotes[actor.id];
    if (action === 'DOCTOR_PROTECT' && night.doctorProtect?.actorId === actor.id) {
      night.doctorProtect = null;
    }
    if (action === 'DETECTIVE_INVESTIGATE' && night.detectiveInvestigate?.actorId === actor.id) {
      night.detectiveInvestigate = null;
    }
  }

  /** True once every living player with a night ability has chosen. */
  allNightActionsSubmitted(): boolean {
    const s = this.state;
    const living = livingPlayers(s).filter((p) => p.connected);
    const pending = living.filter((p) => {
      if (!p.role) return false;
      const action = ROLE_DEFINITIONS[p.role].nightAction;
      if (!action) return false;
      switch (action) {
        case 'MAFIA_KILL':
          return s.night.mafiaVotes[p.id] === undefined;
        case 'DOCTOR_PROTECT':
          return s.night.doctorProtect?.actorId !== p.id;
        case 'DETECTIVE_INVESTIGATE':
          return s.night.detectiveInvestigate?.actorId !== p.id;
      }
    });
    return pending.length === 0;
  }

  // -------------------------------------------------------------------------
  // Voting
  // -------------------------------------------------------------------------

  castVote(playerId: string, targetId: VoteTarget | null): EngineEffect[] {
    const s = this.state;
    const voter = this.requirePlayer(playerId);

    if (s.phase !== 'VOTING') throw new GameError('INVALID_PHASE', 409);
    if (voter.isSpectator) throw new GameError('SPECTATORS_CANNOT_ACT', 403);
    if (!voter.alive) throw new GameError('NOT_ALIVE', 403);

    if (targetId === null) {
      delete s.votes[playerId];
      this.touch();
      return [{ kind: 'VOTE_UPDATED' }, { kind: 'STATE_DIRTY' }];
    }

    if (targetId === SKIP_VOTE) {
      if (!s.settings.allowSkipVote) throw new GameError('INVALID_TARGET', 400);
      s.votes[playerId] = SKIP_VOTE;
    } else {
      const target = findPlayer(s, targetId);
      if (!target || !target.alive || target.isSpectator) {
        throw new GameError('INVALID_TARGET', 400);
      }
      s.votes[playerId] = target.id;
    }

    this.recordEvent(
      'VOTE_CAST',
      'SERVER',
      `${voter.name} voted for ${targetId === SKIP_VOTE ? 'Skip' : findPlayer(s, targetId)?.name}`,
    );

    this.touch();
    return [{ kind: 'VOTE_UPDATED' }, { kind: 'STATE_DIRTY' }];
  }

  // -------------------------------------------------------------------------
  // Chat
  // -------------------------------------------------------------------------

  postChat(playerId: string, channel: ChatChannel, body: string): EngineEffect[] {
    const player = this.requirePlayer(playerId);
    const allowed = writableChannel(this.state, player);

    if (!allowed || allowed !== channel) throw new GameError('INVALID_PHASE', 403);

    const clean = sanitizeChatBody(body);
    if (!clean) throw new GameError('VALIDATION_FAILED', 400);

    const message: ChatMessage = {
      id: this.newId(),
      channel,
      playerId: player.id,
      playerName: player.name,
      body: clean,
      createdAt: this.now(),
      system: false,
    };
    this.pushChat(message);
    this.touch();
    return [{ kind: 'CHAT', message }];
  }

  private systemChat(channel: ChatChannel, body: string): EngineEffect {
    const message: ChatMessage = {
      id: this.newId(),
      channel,
      playerId: 'system',
      playerName: 'Narrator',
      body,
      createdAt: this.now(),
      system: true,
    };
    this.pushChat(message);
    return { kind: 'CHAT', message };
  }

  private pushChat(message: ChatMessage): void {
    this.state.chat.push(message);
    if (this.state.chat.length > MAX_CHAT_HISTORY) {
      this.state.chat.splice(0, this.state.chat.length - MAX_CHAT_HISTORY);
    }
  }

  // -------------------------------------------------------------------------
  // Rematch / early end
  // -------------------------------------------------------------------------

  voteRematch(playerId: string, vote: boolean): EngineEffect[] {
    this.assertPhase('GAME_OVER');
    const player = this.requirePlayer(playerId);
    if (player.isSpectator) throw new GameError('SPECTATORS_CANNOT_ACT', 403);

    player.rematchVote = vote;
    this.touch();

    const seated = seatedPlayers(this.state);
    const votes = seated.filter((p) => p.rematchVote).length;

    if (votes >= requiredRematchVotes(seated.length)) {
      return [{ kind: 'STATE_DIRTY' }, ...this.resetToLobby()];
    }
    return [{ kind: 'STATE_DIRTY' }];
  }

  endGameEarly(requesterId: string): EngineEffect[] {
    this.requireHost(requesterId);
    if (this.state.phase === 'LOBBY' || this.state.phase === 'GAME_OVER') {
      throw new GameError('INVALID_PHASE', 409);
    }
    // A host-ended game is scored for the town by convention; the result copy
    // makes clear it was not won on the board.
    return this.enterGameOver('TOWN', 'The host ended the game early.');
  }

  /** Rewind the room to the lobby, keeping the roster but nothing else. */
  resetToLobby(): EngineEffect[] {
    const fx = new EffectCollector();
    const s = this.state;

    GameStateMachine.assertTransition(s.phase, 'LOBBY');

    s.phase = 'LOBBY';
    s.status = 'LOBBY';
    s.dayNumber = 0;
    s.phaseStartedAt = null;
    s.phaseEndsAt = null;
    s.night = emptyNightState();
    s.pendingResolution = null;
    s.votes = {};
    s.doctorHistory = {};
    s.investigations = {};
    s.announcement = null;
    s.result = null;
    s.gameId = null;
    s.events = [];
    s.chat = [];

    // Spectators who were waiting for the next game are seated now.
    for (const p of s.players) {
      p.role = null;
      p.revealedRole = null;
      p.alive = true;
      p.diedOnDay = null;
      p.rematchVote = false;
      p.ready = false;
      if (p.isSpectator) {
        p.isSpectator = false;
        p.seat = s.nextSeat++;
      }
    }

    fx.push({ kind: 'GAME_RESET' });
    fx.push(this.systemChat('LOBBY', 'A new game is being set up. Get ready.'));
    fx.push({ kind: 'STATE_DIRTY' });
    this.touch();
    return fx.drain();
  }

  // -------------------------------------------------------------------------
  // Phase machinery
  // -------------------------------------------------------------------------

  /** Called by the server's timer loop. Advances only when the clock is up. */
  tick(now: number = this.now()): EngineEffect[] {
    const s = this.state;
    if (s.phaseEndsAt === null) return [];
    if (now < s.phaseEndsAt) return [];
    return this.advance();
  }

  /** Force the current phase to end early (all actions in, all votes cast). */
  advance(): EngineEffect[] {
    const next = GameStateMachine.nextOnTimeout(this.state.phase);
    if (!next) return [];
    return this.enterPhase(next);
  }

  private enterPhase(to: Phase): EngineEffect[] {
    const fx = new EffectCollector();
    const s = this.state;
    const from = s.phase;

    GameStateMachine.assertTransition(from, to);

    s.phase = to;
    s.phaseStartedAt = this.now();
    const duration = GameStateMachine.durationFor(to, s.settings);
    s.phaseEndsAt = duration === null ? null : s.phaseStartedAt + duration * 1000;

    fx.pushAll(this.onEnterPhase(to, from));

    // An onEnter handler may have ended the game; only announce the phase we
    // actually came to rest in.
    if (s.phase === to) {
      fx.push({ kind: 'PHASE_CHANGED', from, to, dayNumber: s.dayNumber });
    }
    fx.push({ kind: 'STATE_DIRTY' });
    this.touch();
    return fx.drain();
  }

  private onEnterPhase(phase: Phase, _from: Phase): EngineEffect[] {
    switch (phase) {
      case 'ROLE_REVEAL':
        return this.onRoleReveal();
      case 'NIGHT':
        return this.onNight();
      case 'NIGHT_RESOLUTION':
        return this.onNightResolution();
      case 'DAY_ANNOUNCEMENT':
        return this.onDayAnnouncement();
      case 'DISCUSSION':
        return this.onDiscussion();
      case 'VOTING':
        return this.onVoting();
      case 'VOTE_RESOLUTION':
        return this.onVoteResolution();
      default:
        return [];
    }
  }

  private onRoleReveal(): EngineEffect[] {
    const fx = new EffectCollector();
    const s = this.state;

    s.status = 'IN_PROGRESS';
    s.gameNumber += 1;
    s.dayNumber = 0;

    const seated = seatedPlayers(s);
    const assignment = RoleAssignmentService.assign(
      seated.map((p) => p.id),
      s.settings,
      this.rng,
      this.lastAssignment,
    );
    this.lastAssignment = assignment;

    for (const player of seated) {
      player.role = assignment[player.id] ?? 'CIVILIAN';
      player.alive = true;
      player.diedOnDay = null;
      player.revealedRole = null;
    }

    fx.push({ kind: 'GAME_STARTED', dayNumber: 0 });
    fx.push(
      this.recordEvent('GAME_STARTED', 'PUBLIC', `The game begins with ${seated.length} players.`),
    );

    // Each Mafia member privately learns who their partners are.
    const mafia = mafiaMembers(s);
    if (mafia.length > 1) {
      for (const member of mafia) {
        const allies = mafia.filter((m) => m.id !== member.id).map((m) => m.name);
        fx.push(
          this.recordEvent(
            'GAME_STARTED',
            'PRIVATE',
            `Your Mafia partners: ${allies.join(', ')}.`,
            [member.id],
          ),
        );
      }
    }

    return fx.drain();
  }

  private onNight(): EngineEffect[] {
    const fx = new EffectCollector();
    const s = this.state;

    s.dayNumber += 1;
    s.night = emptyNightState();
    s.pendingResolution = null;
    s.votes = {};
    s.announcement = null;

    fx.push(
      this.recordEvent('NIGHT_FELL', 'PUBLIC', `Night ${s.dayNumber} falls over the town.`),
    );
    fx.push(this.systemChat('DAY', `Night ${s.dayNumber} — the town sleeps.`));
    return fx.drain();
  }

  /**
   * Computes the night's outcome but deliberately does NOT apply it. Holding
   * the result in `pendingResolution` keeps it out of every projection until
   * the day announcement, so nobody can read the outcome early.
   */
  private onNightResolution(): EngineEffect[] {
    const resolution = NightResolutionService.resolve(this.state, this.rng);
    this.state.pendingResolution = resolution;
    return [
      this.recordEvent('PHASE_CHANGED', 'SERVER', `Night ${this.state.dayNumber} resolved.`),
    ];
  }

  private onDayAnnouncement(): EngineEffect[] {
    const fx = new EffectCollector();
    const s = this.state;
    const resolution = s.pendingResolution;
    s.pendingResolution = null;

    // 1. Record the Doctor's protection so the consecutive-night limit works.
    if (resolution?.protectedId && s.night.doctorProtect) {
      const doctorId = s.night.doctorProtect.actorId;
      const previous = s.doctorHistory[doctorId];
      s.doctorHistory[doctorId] =
        previous && previous.targetId === resolution.protectedId
          ? { targetId: resolution.protectedId, count: previous.count + 1 }
          : { targetId: resolution.protectedId, count: 1 };
    }

    // 2. Deliver the Detective's finding — privately, to one player only.
    if (resolution?.investigation) {
      const probe = resolution.investigation;
      const history = s.investigations[probe.detectiveId] ?? [];
      history.push({
        day: probe.day,
        targetId: probe.targetId,
        targetName: probe.targetName,
        isMafia: probe.isMafia,
      });
      s.investigations[probe.detectiveId] = history;

      fx.push({
        kind: 'PRIVATE_RESULT',
        playerId: probe.detectiveId,
        payload: {
          kind: 'INVESTIGATION',
          day: probe.day,
          targetId: probe.targetId,
          targetName: probe.targetName,
          isMafia: probe.isMafia,
        },
      });
      fx.push(
        this.recordEvent(
          'DETECTIVE_INVESTIGATED',
          'PRIVATE',
          `Your investigation: ${probe.targetName} is ${probe.isMafia ? 'MAFIA' : 'NOT Mafia'}.`,
          [probe.detectiveId],
        ),
      );
    }

    // 3. Apply the kill, if the Doctor did not get in the way.
    const victim = resolution?.killedId ? findPlayer(s, resolution.killedId) : null;

    if (victim && victim.alive) {
      fx.pushAll(this.killPlayer(victim, 'MAFIA'));
      const roleLine =
        s.settings.revealRoleOnDeath && victim.revealedRole
          ? ` ${victim.name} was ${ROLE_DEFINITIONS[victim.revealedRole].label}.`
          : '';
      s.announcement = {
        headline: `${victim.name} was found dead.`,
        detail: roleLine.trim() || null,
        tone: 'DEATH',
      };
      fx.push({
        kind: 'ANNOUNCEMENT',
        payload: {
          headline: `${victim.name} was found dead.`,
          detail: roleLine.trim() || null,
          tone: 'DEATH',
        },
      });
      fx.push(this.systemChat('DAY', `Day ${s.dayNumber}. ${victim.name} was found dead.${roleLine}`));
    } else {
      // Crucially, this copy is identical whether the Mafia failed to agree or
      // the Doctor made a save. Nobody learns which.
      s.announcement = {
        headline: 'Everyone survived the night.',
        detail: 'Nobody died.',
        tone: 'RELIEF',
      };
      fx.push(this.recordEvent('NOBODY_DIED', 'PUBLIC', 'Nobody died last night.'));
      fx.push({
        kind: 'ANNOUNCEMENT',
        payload: {
          headline: 'Everyone survived the night.',
          detail: 'Nobody died.',
          tone: 'RELIEF',
        },
      });
      fx.push(this.systemChat('DAY', `Day ${s.dayNumber}. Nobody died last night.`));
    }

    // The successful save is recorded for replays but never shown to anyone.
    if (resolution?.saveSucceeded) {
      fx.push(
        this.recordEvent(
          'DOCTOR_SAVE_SUCCEEDED',
          'SERVER',
          `Doctor saved ${resolution.protectedId}.`,
        ),
      );
    }

    fx.pushAll(this.endGameIfWon());
    return fx.drain();
  }

  private onDiscussion(): EngineEffect[] {
    return [this.systemChat('DAY', 'Discussion has begun. Make your case.')];
  }

  private onVoting(): EngineEffect[] {
    this.state.votes = {};
    return [
      this.recordEvent('PHASE_CHANGED', 'PUBLIC', `Voting has opened on day ${this.state.dayNumber}.`),
      this.systemChat('DAY', 'Voting is open. You may change your vote until time runs out.'),
    ];
  }

  private onVoteResolution(): EngineEffect[] {
    const fx = new EffectCollector();
    const s = this.state;
    const outcome = VotingService.resolve(s, this.rng);

    if (outcome.eliminatedId) {
      const victim = findPlayer(s, outcome.eliminatedId);
      if (victim && victim.alive) {
        fx.pushAll(this.killPlayer(victim, 'VOTE'));
        const roleLine =
          s.settings.revealRoleOnDeath && victim.revealedRole
            ? `${victim.name} was ${ROLE_DEFINITIONS[victim.revealedRole].label}.`
            : null;
        s.announcement = {
          headline: `${victim.name} was eliminated by the town.`,
          detail: roleLine,
          tone: 'DEATH',
        };
        fx.push({
          kind: 'ANNOUNCEMENT',
          payload: {
            headline: `${victim.name} was eliminated by the town.`,
            detail: roleLine,
            tone: 'DEATH',
          },
        });
        fx.push(
          this.systemChat(
            'DAY',
            `${victim.name} was eliminated.${roleLine ? ` ${roleLine}` : ''}`,
          ),
        );
      }
    } else {
      const headline =
        outcome.outcome === 'TIE'
          ? 'The vote ended in a tie. Nobody was eliminated.'
          : outcome.outcome === 'SKIPPED'
            ? 'The town chose to spare everyone today.'
            : 'No votes were cast. Nobody was eliminated.';

      s.announcement = { headline, detail: null, tone: 'NEUTRAL' };
      fx.push(
        this.recordEvent(
          outcome.outcome === 'TIE' ? 'VOTE_TIED' : 'NO_ELIMINATION',
          'PUBLIC',
          headline,
        ),
      );
      fx.push({ kind: 'ANNOUNCEMENT', payload: { headline, detail: null, tone: 'NEUTRAL' } });
      fx.push(this.systemChat('DAY', headline));
    }

    fx.pushAll(this.endGameIfWon());
    return fx.drain();
  }

  // -------------------------------------------------------------------------
  // Death & win
  // -------------------------------------------------------------------------

  private killPlayer(
    player: EnginePlayer,
    cause: 'MAFIA' | 'VOTE' | 'DISCONNECT' | 'HOST',
  ): EngineEffect[] {
    const fx = new EffectCollector();
    const s = this.state;

    player.alive = false;
    player.diedOnDay = s.dayNumber;
    if (s.settings.revealRoleOnDeath) player.revealedRole = player.role;

    // A dead player's pending inputs must not influence anything.
    delete s.votes[player.id];
    delete s.night.mafiaVotes[player.id];
    if (s.night.doctorProtect?.actorId === player.id) s.night.doctorProtect = null;
    if (s.night.detectiveInvestigate?.actorId === player.id) s.night.detectiveInvestigate = null;

    fx.push({
      kind: 'PLAYER_DIED',
      payload: {
        playerId: player.id,
        playerName: player.name,
        revealedRole: player.revealedRole,
        cause,
        dayNumber: s.dayNumber,
      },
    });
    fx.push(
      this.recordEvent(
        cause === 'VOTE' ? 'PLAYER_ELIMINATED' : 'PLAYER_DIED',
        'PUBLIC',
        player.revealedRole
          ? `${player.name} died. They were ${ROLE_DEFINITIONS[player.revealedRole].label}.`
          : `${player.name} died.`,
      ),
    );

    // Hand the room over if the host is the one who just died mid-game.
    if (player.isHost) fx.pushAll(this.promoteNewHost());

    return fx.drain();
  }

  /** Checked after every death. Ends the game the moment a side has won. */
  private endGameIfWon(): EngineEffect[] {
    if (!GameStateMachine.isInGame(this.state.phase)) return [];
    const verdict = WinConditionService.evaluate(this.state);
    if (!verdict.winner) return [];
    return this.enterGameOver(verdict.winner, verdict.reason);
  }

  private enterGameOver(winner: 'TOWN' | 'MAFIA', reason: string): EngineEffect[] {
    const fx = new EffectCollector();
    const s = this.state;

    GameStateMachine.assertTransition(s.phase, 'GAME_OVER');
    const from = s.phase;

    s.phase = 'GAME_OVER';
    s.status = 'FINISHED';
    s.phaseStartedAt = this.now();
    s.phaseEndsAt = null;

    // Everything is public now.
    for (const p of s.players) {
      if (!p.isSpectator && p.role) p.revealedRole = p.role;
      p.rematchVote = false;
    }

    const result: GameResult = {
      winner,
      reason,
      roster: seatedPlayers(s).map((p) => ({
        playerId: p.id,
        name: p.name,
        role: (p.role ?? 'CIVILIAN') as Role,
        team: teamOf((p.role ?? 'CIVILIAN') as Role),
        alive: p.alive,
        diedOnDay: p.diedOnDay,
      })),
    };
    s.result = result;
    s.announcement = {
      headline: winner === 'MAFIA' ? 'The Mafia win.' : 'The town wins.',
      detail: reason,
      tone: 'VICTORY',
    };

    fx.push(this.recordEvent('GAME_OVER', 'PUBLIC', `${winner === 'MAFIA' ? 'Mafia' : 'Town'} wins. ${reason}`));
    fx.push({ kind: 'GAME_OVER', result });
    fx.push({ kind: 'PHASE_CHANGED', from, to: 'GAME_OVER', dayNumber: s.dayNumber });
    this.touch();
    return fx.drain();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private recordEvent(
    type: GameEventType,
    visibility: GameEventVisibility,
    message: string,
    audience: string[] = [],
    payload?: Record<string, unknown>,
  ): EngineEffect {
    const event: GameEvent = {
      id: this.newId(),
      type,
      visibility,
      audience,
      day: this.state.dayNumber,
      phase: this.state.phase,
      message,
      createdAt: this.now(),
      ...(payload ? { payload } : {}),
    };
    this.state.events.push(event);
    if (this.state.events.length > MAX_EVENT_HISTORY) {
      this.state.events.splice(0, this.state.events.length - MAX_EVENT_HISTORY);
    }
    return { kind: 'EVENT', event };
  }

  private requirePlayer(playerId: string): EnginePlayer {
    const player = findPlayer(this.state, playerId);
    if (!player) throw new GameError('NOT_IN_ROOM', 403);
    return player;
  }

  private requireHost(playerId: string): EnginePlayer {
    const player = this.requirePlayer(playerId);
    if (!player.isHost) throw new GameError('NOT_HOST', 403);
    return player;
  }

  private assertPhase(...phases: Phase[]): void {
    if (!phases.includes(this.state.phase)) throw new GameError('INVALID_PHASE', 409);
  }
}

/** Strips control characters and collapses runaway whitespace. */
function sanitizeChatBody(body: string): string {
  return body
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}