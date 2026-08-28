import type { InvestigationResult } from '@mafia/shared';
import { findPlayer, livingMafia, type GameState } from './state';
import { pickOne, type Rng } from './rng';

export interface NightResolution {
  /** The player the Mafia agreed on, or null if they failed to agree. */
  mafiaTargetId: string | null;
  /** Why there is no Mafia target, for the private Mafia log. */
  mafiaFailureReason: 'NO_VOTES' | 'TIE' | null;
  protectedId: string | null;
  /** The player who actually died, after protection was applied. */
  killedId: string | null;
  /** True when the Doctor's pick matched the Mafia's. Server-only knowledge. */
  saveSucceeded: boolean;
  investigation: (InvestigationResult & { detectiveId: string }) | null;
}

export class NightResolutionService {
  /**
   * Pure resolution of one night. Does NOT mutate state — the caller applies
   * the outcome. Order follows the spec: determine target, determine
   * protection, compute the investigation, then apply the kill.
   */
  static resolve(state: GameState, rng: Rng): NightResolution {
    const { mafiaTargetId, reason } = NightResolutionService.resolveMafiaTarget(state, rng);
    const protectedId = NightResolutionService.resolveProtection(state);
    const investigation = NightResolutionService.resolveInvestigation(state);

    let killedId: string | null = null;
    let saveSucceeded = false;

    if (mafiaTargetId) {
      const target = findPlayer(state, mafiaTargetId);
      // Re-validate at resolution time: the target may have died to another
      // effect, or been removed, since the action was submitted.
      if (target && target.alive && !target.isSpectator) {
        if (protectedId === mafiaTargetId) {
          saveSucceeded = true;
        } else {
          killedId = mafiaTargetId;
        }
      }
    }

    return {
      mafiaTargetId,
      mafiaFailureReason: reason,
      protectedId,
      killedId,
      saveSucceeded,
      investigation,
    };
  }

  /**
   * The Mafia settle on a target by plurality among living Mafia members.
   * A unique highest-voted player is killed. A tie — or nobody voting at all —
   * means no kill happens that night.
   *
   * With a single Mafia member their lone vote is trivially the plurality,
   * which gives the "one Mafia picks directly" behaviour small games want.
   */
  static resolveMafiaTarget(
    state: GameState,
    rng: Rng,
  ): { mafiaTargetId: string | null; reason: 'NO_VOTES' | 'TIE' | null } {
    const livingMafiaIds = new Set(livingMafia(state).map((p) => p.id));
    const counts = new Map<string, number>();

    for (const [voterId, targetId] of Object.entries(state.night.mafiaVotes)) {
      // Votes from Mafia who have since died are discarded.
      if (!livingMafiaIds.has(voterId)) continue;
      const target = findPlayer(state, targetId);
      if (!target || !target.alive || target.isSpectator || target.role === 'MAFIA') continue;
      counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
    }

    if (counts.size === 0) return { mafiaTargetId: null, reason: 'NO_VOTES' };

    let best = 0;
    for (const n of counts.values()) if (n > best) best = n;
    const leaders = [...counts.entries()].filter(([, n]) => n === best).map(([id]) => id);

    if (leaders.length === 1) return { mafiaTargetId: leaders[0] as string, reason: null };

    // Tied. The spec's default is "no kill"; RANDOM breaks the tie instead.
    if (state.settings.tieRule === 'RANDOM') {
      return { mafiaTargetId: pickOne(leaders, rng), reason: null };
    }
    return { mafiaTargetId: null, reason: 'TIE' };
  }

  /** The Doctor's protection, re-validated against the live roster. */
  static resolveProtection(state: GameState): string | null {
    const protect = state.night.doctorProtect;
    if (!protect) return null;

    const doctor = findPlayer(state, protect.actorId);
    if (!doctor || !doctor.alive || doctor.role !== 'DOCTOR') return null;

    const target = findPlayer(state, protect.targetId);
    if (!target || !target.alive || target.isSpectator) return null;

    if (!state.settings.doctorCanSelfProtect && target.id === doctor.id) return null;

    return target.id;
  }

  static resolveInvestigation(
    state: GameState,
  ): (InvestigationResult & { detectiveId: string }) | null {
    const probe = state.night.detectiveInvestigate;
    if (!probe) return null;

    const detective = findPlayer(state, probe.actorId);
    if (!detective || !detective.alive || detective.role !== 'DETECTIVE') return null;

    const target = findPlayer(state, probe.targetId);
    // A dead player yields nothing — the Detective's night is wasted.
    if (!target || !target.alive || target.isSpectator) return null;

    return {
      detectiveId: detective.id,
      day: state.dayNumber,
      targetId: target.id,
      targetName: target.name,
      isMafia: target.role === 'MAFIA',
    };
  }

  /**
   * Whether `doctorId` may protect `targetId` given the consecutive-protection
   * limit. Enforced both when the action is submitted and at resolution.
   */
  static canDoctorProtect(
    state: GameState,
    doctorId: string,
    targetId: string,
  ): { allowed: boolean; reason?: string } {
    const doctor = findPlayer(state, doctorId);
    if (!doctor || doctor.role !== 'DOCTOR') return { allowed: false, reason: 'Not the Doctor' };

    const target = findPlayer(state, targetId);
    if (!target || !target.alive || target.isSpectator) {
      return { allowed: false, reason: 'Target is not alive' };
    }

    if (targetId === doctorId && !state.settings.doctorCanSelfProtect) {
      return { allowed: false, reason: 'Self-protection is disabled in this room' };
    }

    const history = state.doctorHistory[doctorId];
    const limit = state.settings.doctorMaxConsecutiveSameTarget;
    if (history && history.targetId === targetId && history.count >= limit) {
      return {
        allowed: false,
        reason: `You have already protected this player ${limit} nights running`,
      };
    }

    return { allowed: true };
  }
}
