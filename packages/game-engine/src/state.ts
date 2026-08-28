import {
  DEFAULT_SETTINGS,
  sanitizeSettings,
  type ChatMessage,
  type GameEvent,
  type GameResult,
  type GameSettings,
  type GameSettingsPatch,
  type InvestigationResult,
  type Phase,
  type Role,
  type RoomStatus,
  type VoteTarget,
} from '@mafia/shared';

export interface EnginePlayer {
  id: string;
  name: string;
  seat: number;
  isHost: boolean;
  isSpectator: boolean;
  ready: boolean;
  /** Server-only. Never projected to a client that shouldn't see it. */
  role: Role | null;
  alive: boolean;
  connected: boolean;
  /** Epoch ms of the last disconnect, or null while connected. */
  disconnectedAt: number | null;
  diedOnDay: number | null;
  /** Set when the role became public (death reveal / game over). */
  revealedRole: Role | null;
  rematchVote: boolean;
  joinedAt: number;
}

export interface NightState {
  /** Living Mafia member id -> chosen target id. */
  mafiaVotes: Record<string, string>;
  doctorProtect: { actorId: string; targetId: string } | null;
  detectiveInvestigate: { actorId: string; targetId: string } | null;
}

export interface PendingNightResolution {
  mafiaTargetId: string | null;
  mafiaFailureReason: 'NO_VOTES' | 'TIE' | null;
  protectedId: string | null;
  killedId: string | null;
  saveSucceeded: boolean;
  investigation: (InvestigationResult & { detectiveId: string }) | null;
}

export interface AnnouncementState {
  headline: string;
  detail: string | null;
  tone: 'NEUTRAL' | 'DEATH' | 'RELIEF' | 'VICTORY';
}

/**
 * The complete authoritative state of one room. This object is the single
 * source of truth; the server persists it and projects redacted views of it.
 */
export interface GameState {
  roomCode: string;
  roomName: string;
  status: RoomStatus;
  hostId: string;
  settings: GameSettings;

  phase: Phase;
  dayNumber: number;
  phaseStartedAt: number | null;
  phaseEndsAt: number | null;

  players: EnginePlayer[];

  night: NightState;
  /**
   * Outcome computed at NIGHT_RESOLUTION but not applied until
   * DAY_ANNOUNCEMENT, so the result never leaks into a projection early.
   */
  pendingResolution: PendingNightResolution | null;
  /** Voter id -> target id or 'SKIP'. */
  votes: Record<string, VoteTarget>;
  /** Doctor id -> the target they protected last night and for how many nights running. */
  doctorHistory: Record<string, { targetId: string; count: number }>;
  /** Detective id -> everything they have learned. */
  investigations: Record<string, InvestigationResult[]>;

  chat: ChatMessage[];
  events: GameEvent[];

  announcement: AnnouncementState | null;
  result: GameResult | null;

  /** Increments on every rematch; used to key persisted Game rows. */
  gameNumber: number;
  /** Database id of the current Game row, when persistence is enabled. */
  gameId: string | null;
  nextSeat: number;
  createdAt: number;
  updatedAt: number;
}

export function emptyNightState(): NightState {
  return { mafiaVotes: {}, doctorProtect: null, detectiveInvestigate: null };
}

export function createGameState(params: {
  roomCode: string;
  roomName: string;
  hostId: string;
  settings?: GameSettingsPatch;
  now: number;
}): GameState {
  return {
    roomCode: params.roomCode,
    roomName: params.roomName,
    status: 'LOBBY',
    hostId: params.hostId,
    settings: sanitizeSettings(DEFAULT_SETTINGS, params.settings ?? {}),
    phase: 'LOBBY',
    dayNumber: 0,
    phaseStartedAt: null,
    phaseEndsAt: null,
    players: [],
    night: emptyNightState(),
    pendingResolution: null,
    votes: {},
    doctorHistory: {},
    investigations: {},
    chat: [],
    events: [],
    announcement: null,
    result: null,
    gameNumber: 0,
    gameId: null,
    nextSeat: 1,
    createdAt: params.now,
    updatedAt: params.now,
  };
}

// ---------------------------------------------------------------------------
// Query helpers — used across every service, so they live with the state.
// ---------------------------------------------------------------------------

export function findPlayer(state: GameState, playerId: string): EnginePlayer | undefined {
  return state.players.find((p) => p.id === playerId);
}

/** Seated (non-spectator) players, alive or dead. */
export function seatedPlayers(state: GameState): EnginePlayer[] {
  return state.players.filter((p) => !p.isSpectator);
}

export function livingPlayers(state: GameState): EnginePlayer[] {
  return state.players.filter((p) => p.alive && !p.isSpectator);
}

export function livingMafia(state: GameState): EnginePlayer[] {
  return livingPlayers(state).filter((p) => p.role === 'MAFIA');
}

export function livingTown(state: GameState): EnginePlayer[] {
  return livingPlayers(state).filter((p) => p.role !== 'MAFIA');
}

export function mafiaMembers(state: GameState): EnginePlayer[] {
  return state.players.filter((p) => p.role === 'MAFIA' && !p.isSpectator);
}

/**
 * A player counts as "actionable" when they are alive and either connected or
 * still inside the reconnect grace window. Disconnected players' actions and
 * votes are skipped rather than blocking the phase.
 */
export function isActionable(player: EnginePlayer): boolean {
  return player.alive && !player.isSpectator;
}

export function nameOf(state: GameState, playerId: string): string {
  return findPlayer(state, playerId)?.name ?? 'Unknown';
}
