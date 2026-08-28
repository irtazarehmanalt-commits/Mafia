import type { NightActionType, Role, Team } from './types';

export interface RoleDefinition {
  role: Role;
  team: Team;
  label: string;
  /** One line, used in lists and on cards. */
  tagline: string;
  /** Full brief, shown on the role-reveal screen. */
  description: string;
  /** Night ability this role submits, if any. */
  nightAction: NightActionType | null;
}

export const ROLE_DEFINITIONS: Record<Role, RoleDefinition> = {
  MAFIA: {
    role: 'MAFIA',
    team: 'MAFIA',
    label: 'Mafia',
    tagline: 'Each night you agree on one player to kill. You know your partners.',
    description:
      'Every night you and your family settle on one victim. By day you sit at the same table as everyone else and steer the vote away from your own. You win the moment the Mafia equal the rest of the table.',
    nightAction: 'MAFIA_KILL',
  },
  DOCTOR: {
    role: 'DOCTOR',
    team: 'TOWN',
    label: 'Doctor',
    tagline: 'Protect one player each night. You are never told whether it worked.',
    description:
      'Every night you choose one person to protect. If the Mafia come for them, they survive — but the morning reads the same either way. You will never be told whether it mattered.',
    nightAction: 'DOCTOR_PROTECT',
  },
  DETECTIVE: {
    role: 'DETECTIVE',
    team: 'TOWN',
    label: 'Detective',
    tagline: 'Investigate one player each night. The answer is Mafia, or not Mafia.',
    description:
      'Every night you investigate one living player. The server tells you one thing only: Mafia, or not Mafia. Your results are private — convincing the table without exposing yourself is the hard part.',
    nightAction: 'DETECTIVE_INVESTIGATE',
  },
  CIVILIAN: {
    role: 'CIVILIAN',
    team: 'TOWN',
    label: 'Civilian',
    tagline: 'No ability. Only your read of the room and your vote.',
    description:
      'You have no night ability. Your weapons are attention, argument and your vote. Find the Mafia before they finish the town.',
    nightAction: null,
  },
};

export function teamOf(role: Role): Team {
  return ROLE_DEFINITIONS[role].team;
}

export function isMafiaRole(role: Role | null | undefined): boolean {
  return role === 'MAFIA';
}

export function nightActionFor(role: Role): NightActionType | null {
  return ROLE_DEFINITIONS[role].nightAction;
}

/** The role a given night action requires the actor to hold. */
export const ACTION_REQUIRED_ROLE: Record<NightActionType, Role> = {
  MAFIA_KILL: 'MAFIA',
  DOCTOR_PROTECT: 'DOCTOR',
  DETECTIVE_INVESTIGATE: 'DETECTIVE',
};
