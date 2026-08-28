'use client';

import type { Phase } from '@mafia/shared';
import { cn } from '@/lib/cn';
import { useGame } from '../GameProvider';
import { useCountdown } from '../useCountdown';

const PHASE_LABELS: Record<Phase, string> = {
  LOBBY: 'Lobby',
  ROLE_REVEAL: 'Role reveal',
  NIGHT: 'Night',
  NIGHT_RESOLUTION: 'The night ends',
  DAY_ANNOUNCEMENT: 'Announcement',
  DISCUSSION: 'Discussion',
  VOTING: 'Voting',
  VOTE_RESOLUTION: 'Verdict',
  GAME_OVER: 'Game over',
};

export function phaseLabel(phase: Phase, day: number): string {
  const base = PHASE_LABELS[phase];
  if (phase === 'NIGHT' || phase === 'NIGHT_RESOLUTION') return `Night ${day}`;
  if (day > 0 && phase !== 'GAME_OVER' && phase !== 'LOBBY' && phase !== 'ROLE_REVEAL') {
    return `Day ${day} · ${base}`;
  }
  return base;
}

/**
 * Server-authoritative countdown. Both the digits and the bar derive from the
 * server's `phaseEndsAt`, corrected by the measured clock offset — so this is
 * accurate immediately after a refresh.
 */
export function PhaseTimer({ withBar = true }: { withBar?: boolean }) {
  const { state, clockOffset } = useGame();
  const countdown = useCountdown(
    state?.phaseEndsAt ?? null,
    clockOffset,
    state?.phaseStartedAt ?? null,
  );

  if (!state || !countdown.active) return null;

  const urgent = countdown.seconds <= 10;

  return (
    <div className="flex items-center gap-3 sm:gap-4">
      {withBar && (
        <div className="hidden h-1.5 w-32 bg-neutral-300 sm:block lg:w-[220px]">
          <div
            className="h-1.5 transition-[width] duration-300 ease-linear"
            style={{
              width: `${(1 - countdown.progress) * 100}%`,
              background: 'var(--color-accent)',
            }}
          />
        </div>
      )}
      <span
        className={cn('mono tabular-nums', urgent && 'animate-bar-pulse')}
        style={{
          fontSize: 22,
          letterSpacing: '0.06em',
          color: urgent ? 'var(--color-accent)' : undefined,
        }}
      >
        {countdown.label.includes(':') ? countdown.label : `00:${countdown.label}`}
      </span>
    </div>
  );
}
