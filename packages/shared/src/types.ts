/**
 * Core domain vocabulary shared by the game engine, the socket server and the
 * web client. Everything in this file is transport-safe (JSON serialisable).
 */

export const ROLES = ['MAFIA', 'DOCTOR', 'DETECTIVE', 'CIVILIAN'] as const;
export type Role = (typeof ROLES)[number];

export const TEAMS = ['MAFIA', 'TOWN'] as const;
export type Team = (typeof TEAMS)[number];

/** Server-controlled state machine nodes. */
export const PHASES = [
  'LOBBY',
  'ROLE_REVEAL',
  'NIGHT',
  'NIGHT_RESOLUTION',
  'DAY_ANNOUNCEMENT',
  'DISCUSSION',
  'VOTING',
  'VOTE_RESOLUTION',
  'GAME_OVER',
] as const;
export type Phase = (typeof PHASES)[number];

export type RoomStatus = 'LOBBY' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELLED';

/** Night abilities a player may submit. */
export type NightActionType = 'MAFIA_KILL' | 'DOCTOR_PROTECT' | 'DETECTIVE_INVESTIGATE';

/** A day-phase vote target. `SKIP` is an explicit abstention. */
export const SKIP_VOTE = 'SKIP';
export type VoteTarget = string | typeof SKIP_VOTE;

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

/**
 * The projection of a player that is safe to broadcast to *everyone* in the
 * room. Note the deliberate absence of `role` — a role only ever appears here
 * once it has been publicly revealed (death reveal or game over).
 */
export interface PublicPlayer {
  id: string;
  name: string;
  seat: number;
  isHost: boolean;
  alive: boolean;
  connected: boolean;
  isSpectator: boolean;
  ready: boolean;
  /** Populated only when the role has become public knowledge. */
  revealedRole: Role | null;
  /** Set when the player died, used for ordering the graveyard. */
  diedOnDay: number | null;
}

/**
 * The private slice of state that belongs to exactly one recipient. Built
 * per-socket by the server; never broadcast.
 */
export interface PrivatePlayerState {
  playerId: string;
  role: Role | null;
  team: Team | null;
  alive: boolean;
  isHost: boolean;
  isSpectator: boolean;
  /** Whether this player has marked themselves ready in the lobby. */
  ready: boolean;
  /** Ids of fellow Mafia (Mafia recipients only). */
  mafiaAllies: string[];
  /** What this player has submitted for the current night, if anything. */
  pendingNightTarget: string | null;
  /**
   * A target this player's ability may not pick tonight — currently only the
   * Doctor, who cannot guard the same person more nights running than the room
   * allows. Sent so the UI can disable the option instead of letting the
   * server reject it after the fact.
   */
  blockedTargetId: string | null;
  /** Live tally of Mafia target votes — visible to Mafia during NIGHT only. */
  mafiaTargetVotes: Record<string, string>;
  /** Detective's own investigation history. */
  investigations: InvestigationResult[];
  /** This player's current day vote. */
  currentVote: VoteTarget | null;
  /** Whether this player has voted to rematch. */
  rematchVote: boolean;
}

export interface InvestigationResult {
  day: number;
  targetId: string;
  targetName: string;
  isMafia: boolean;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type TieRule = 'NO_ELIMINATION' | 'RANDOM';
export type DisconnectPolicy = 'KEEP_INACTIVE' | 'ELIMINATE';

export interface PhaseDurations {
  ROLE_REVEAL: number;
  NIGHT: number;
  NIGHT_RESOLUTION: number;
  DAY_ANNOUNCEMENT: number;
  DISCUSSION: number;
  VOTING: number;
  VOTE_RESOLUTION: number;
}

export interface RoleCounts {
  MAFIA: number;
  DOCTOR: number;
  DETECTIVE: number;
}

export interface GameSettings {
  maxPlayers: number;
  minPlayers: number;
  /** Seconds per phase. Server-authoritative. */
  durations: PhaseDurations;
  /** Reveal a player's role publicly when they die. */
  revealRoleOnDeath: boolean;
  /** Doctor may target themselves. */
  doctorCanSelfProtect: boolean;
  /** Max consecutive nights the Doctor may protect the same player. */
  doctorMaxConsecutiveSameTarget: number;
  /** Show live vote counts to everyone during VOTING. */
  publicVotes: boolean;
  /** Allow an explicit "skip" vote. */
  allowSkipVote: boolean;
  tieRule: TieRule;
  /** What happens to a player who never reconnects. */
  disconnectPolicy: DisconnectPolicy;
  /** Grace period (seconds) before a disconnect is considered abandonment. */
  reconnectGraceSeconds: number;
  /** Allow late joiners to watch. */
  allowSpectators: boolean;
  /** Dead players get their own chat channel. */
  deadChatEnabled: boolean;
  /**
   * Override automatic role balancing. `null` = derive from player count.
   */
  roleCountOverride: RoleCounts | null;
}

// ---------------------------------------------------------------------------
// Chat & events
// ---------------------------------------------------------------------------

export type ChatChannel = 'LOBBY' | 'DAY' | 'MAFIA' | 'DEAD';

export interface ChatMessage {
  id: string;
  channel: ChatChannel;
  playerId: string;
  playerName: string;
  body: string;
  createdAt: number;
  /** True for server-authored notices rendered differently in the UI. */
  system: boolean;
}

export type GameEventVisibility = 'PUBLIC' | 'PRIVATE' | 'SERVER';

export type GameEventType =
  | 'GAME_STARTED'
  | 'PHASE_CHANGED'
  | 'NIGHT_FELL'
  | 'PLAYER_DIED'
  | 'NOBODY_DIED'
  | 'MAFIA_SELECTED_TARGET'
  | 'DOCTOR_PROTECTED'
  | 'DOCTOR_SAVE_SUCCEEDED'
  | 'DETECTIVE_INVESTIGATED'
  | 'VOTE_CAST'
  | 'PLAYER_ELIMINATED'
  | 'VOTE_TIED'
  | 'NO_ELIMINATION'
  | 'PLAYER_DISCONNECTED'
  | 'PLAYER_RECONNECTED'
  | 'PLAYER_LEFT'
  | 'HOST_TRANSFERRED'
  | 'GAME_OVER';

export interface GameEvent {
  id: string;
  type: GameEventType;
  visibility: GameEventVisibility;
  /** Recipients for PRIVATE events. Empty for PUBLIC/SERVER. */
  audience: string[];
  day: number;
  phase: Phase;
  /** Pre-rendered, already-redacted human readable line. */
  message: string;
  createdAt: number;
  payload?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Wire state
// ---------------------------------------------------------------------------

export interface VoteTally {
  targetId: VoteTarget;
  targetName: string;
  votes: number;
  voterIds: string[];
}

export interface GameResult {
  winner: Team;
  reason: string;
  /** Full role reveal — only ever sent once the game is over. */
  roster: Array<{
    playerId: string;
    name: string;
    role: Role;
    team: Team;
    alive: boolean;
    diedOnDay: number | null;
  }>;
}

/**
 * The complete, already-redacted snapshot a single client needs to render the
 * entire UI. Sent on connect, on every phase change and on every mutation.
 */
export interface RoomStateForClient {
  roomCode: string;
  roomName: string;
  status: RoomStatus;
  hostId: string;
  settings: GameSettings;

  phase: Phase;
  dayNumber: number;
  /** Epoch ms. Null in phases without a timer (LOBBY / GAME_OVER). */
  phaseStartedAt: number | null;
  phaseEndsAt: number | null;
  /** Server clock at send time, so clients can correct for drift. */
  serverTime: number;

  players: PublicPlayer[];
  you: PrivatePlayerState;

  /** Chat visible to this recipient only. */
  chat: ChatMessage[];
  /** Events visible to this recipient only. */
  events: GameEvent[];

  /** Present during VOTING / VOTE_RESOLUTION when votes are public. */
  voteTallies: VoteTally[] | null;
  /** Headline shown during DAY_ANNOUNCEMENT / VOTE_RESOLUTION. */
  announcement: string | null;
  /** Populated in GAME_OVER only. */
  result: GameResult | null;

  rematch: { votes: number; required: number; youVoted: boolean } | null;
}
