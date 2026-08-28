import {
  teamOf,
  type ChatChannel,
  type ChatMessage,
  type GameEvent,
  type PrivatePlayerState,
  type PublicPlayer,
  type RoomStateForClient,
  type VoteTally,
} from '@mafia/shared';
import { GameStateMachine } from './GameStateMachine';
import { VotingService } from './VotingService';
import { findPlayer, seatedPlayers, type EnginePlayer, type GameState } from './state';

const MAX_CHAT_SENT = 200;
const MAX_EVENTS_SENT = 120;

/**
 * Builds the per-recipient view of a room.
 *
 * This is the single choke point where secret state is stripped. Nothing else
 * in the codebase is allowed to serialise a `GameState` towards a client, so
 * auditing information leaks means auditing this file.
 */
export class ProjectionService {
  static forPlayer(state: GameState, viewerId: string, now: number): RoomStateForClient {
    const viewer = findPlayer(state, viewerId);

    return {
      roomCode: state.roomCode,
      roomName: state.roomName,
      status: state.status,
      hostId: state.hostId,
      settings: state.settings,

      phase: state.phase,
      dayNumber: state.dayNumber,
      phaseStartedAt: state.phaseStartedAt,
      phaseEndsAt: state.phaseEndsAt,
      serverTime: now,

      players: state.players.map(toPublicPlayer),
      you: buildPrivateState(state, viewer),

      chat: visibleChat(state, viewer),
      events: visibleEvents(state, viewerId),

      voteTallies: visibleTallies(state),
      announcement: state.announcement?.headline ?? null,
      result: state.phase === 'GAME_OVER' ? state.result : null,

      rematch: buildRematch(state, viewer),
    };
  }
}

/**
 * The broadcast-safe shape of a player. `role` is deliberately absent — only
 * `revealedRole`, which the engine sets when a role becomes public knowledge.
 */
function toPublicPlayer(p: EnginePlayer): PublicPlayer {
  return {
    id: p.id,
    name: p.name,
    seat: p.seat,
    isHost: p.isHost,
    alive: p.alive,
    connected: p.connected,
    isSpectator: p.isSpectator,
    ready: p.ready,
    revealedRole: p.revealedRole,
    diedOnDay: p.diedOnDay,
  };
}

function buildPrivateState(
  state: GameState,
  viewer: EnginePlayer | undefined,
): PrivatePlayerState {
  if (!viewer) {
    return {
      playerId: '',
      role: null,
      team: null,
      alive: false,
      isHost: false,
      isSpectator: true,
      ready: false,
      mafiaAllies: [],
      pendingNightTarget: null,
      blockedTargetId: null,
      mafiaTargetVotes: {},
      investigations: [],
      currentVote: null,
      rematchVote: false,
    };
  }

  const isMafia = viewer.role === 'MAFIA';

  // Mafia know each other from the moment roles are dealt, and keep that
  // knowledge after death.
  const mafiaAllies = isMafia
    ? state.players.filter((p) => p.role === 'MAFIA' && p.id !== viewer.id).map((p) => p.id)
    : [];

  // The live Mafia tally is night-only, Mafia-only information.
  const mafiaTargetVotes =
    isMafia && state.phase === 'NIGHT' ? { ...state.night.mafiaVotes } : {};

  return {
    playerId: viewer.id,
    role: viewer.role,
    team: viewer.role ? teamOf(viewer.role) : null,
    alive: viewer.alive,
    isHost: viewer.isHost,
    isSpectator: viewer.isSpectator,
    ready: viewer.ready,
    mafiaAllies,
    pendingNightTarget: pendingTargetFor(state, viewer),
    blockedTargetId: blockedTargetFor(state, viewer),
    mafiaTargetVotes,
    investigations: state.investigations[viewer.id] ?? [],
    currentVote: state.votes[viewer.id] ?? null,
    rematchVote: viewer.rematchVote,
  };
}

/** What this player has locked in for the current night, if anything. */
function pendingTargetFor(state: GameState, viewer: EnginePlayer): string | null {
  if (state.phase !== 'NIGHT') return null;
  switch (viewer.role) {
    case 'MAFIA':
      return state.night.mafiaVotes[viewer.id] ?? null;
    case 'DOCTOR':
      return state.night.doctorProtect?.actorId === viewer.id
        ? state.night.doctorProtect.targetId
        : null;
    case 'DETECTIVE':
      return state.night.detectiveInvestigate?.actorId === viewer.id
        ? state.night.detectiveInvestigate.targetId
        : null;
    default:
      return null;
  }
}

/**
 * The Doctor may not guard the same player more nights running than the room
 * allows. Surfacing it lets the client disable the option rather than have the
 * server reject the click — the rule itself is still enforced server-side.
 */
function blockedTargetFor(state: GameState, viewer: EnginePlayer): string | null {
  if (viewer.role !== 'DOCTOR') return null;
  const history = state.doctorHistory[viewer.id];
  if (!history) return null;
  return history.count >= state.settings.doctorMaxConsecutiveSameTarget
    ? history.targetId
    : null;
}

/** Which chat channels this viewer is allowed to *read*. */
export function readableChannels(
  state: GameState,
  viewer: EnginePlayer | undefined,
): Set<ChatChannel> {
  const channels = new Set<ChatChannel>(['LOBBY']);
  if (!viewer) return channels;

  // Everyone in the room — including the dead and spectators — follows the
  // public day conversation.
  channels.add('DAY');

  if (viewer.role === 'MAFIA') channels.add('MAFIA');

  if (state.settings.deadChatEnabled && (!viewer.alive || viewer.isSpectator)) {
    channels.add('DEAD');
  }

  return channels;
}

/**
 * Which channel this viewer may *write* to right now. Returns null when they
 * are not allowed to speak at all — e.g. a dead player during the day, or
 * anyone during the night who is not Mafia.
 */
export function writableChannel(
  state: GameState,
  viewer: EnginePlayer,
): ChatChannel | null {
  if (state.phase === 'LOBBY') return 'LOBBY';

  if (viewer.isSpectator || !viewer.alive) {
    return state.settings.deadChatEnabled ? 'DEAD' : null;
  }

  if (state.phase === 'NIGHT') {
    // Only the Mafia conspire at night, and only among themselves.
    return viewer.role === 'MAFIA' ? 'MAFIA' : null;
  }

  if (GameStateMachine.isDay(state.phase)) return 'DAY';

  return null;
}

function visibleChat(state: GameState, viewer: EnginePlayer | undefined): ChatMessage[] {
  const allowed = readableChannels(state, viewer);
  return state.chat.filter((m) => allowed.has(m.channel)).slice(-MAX_CHAT_SENT);
}

function visibleEvents(state: GameState, viewerId: string): GameEvent[] {
  return state.events
    .filter((e) => {
      // SERVER events exist purely for operator debugging and never ship.
      if (e.visibility === 'SERVER') return false;
      if (e.visibility === 'PUBLIC') return true;
      return e.audience.includes(viewerId);
    })
    .slice(-MAX_EVENTS_SENT);
}

/**
 * Live tallies during VOTING are gated on the `publicVotes` setting. Once the
 * vote has resolved the breakdown is always shown, so players can see how the
 * decision was reached.
 */
function visibleTallies(state: GameState): VoteTally[] | null {
  if (state.phase === 'VOTING') {
    return state.settings.publicVotes ? VotingService.tally(state) : null;
  }
  if (state.phase === 'VOTE_RESOLUTION') return VotingService.tally(state);
  return null;
}

function buildRematch(
  state: GameState,
  viewer: EnginePlayer | undefined,
): RoomStateForClient['rematch'] {
  if (state.phase !== 'GAME_OVER') return null;
  const seated = seatedPlayers(state);
  const votes = seated.filter((p) => p.rematchVote).length;
  return {
    votes,
    required: requiredRematchVotes(seated.length),
    youVoted: viewer?.rematchVote ?? false,
  };
}

/** A simple majority of seated players is enough to restart. */
export function requiredRematchVotes(seatedCount: number): number {
  return Math.max(1, Math.ceil(seatedCount / 2));
}
