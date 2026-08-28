'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface Countdown {
  /** Milliseconds remaining, clamped at zero. */
  remainingMs: number;
  /** Whole seconds remaining. */
  seconds: number;
  /** 0 → just started, 1 → expired. */
  progress: number;
  label: string;
  expired: boolean;
  active: boolean;
}

/**
 * Derives a countdown from server timestamps rather than a local interval
 * counter.
 *
 * The server is the only authority on time: it sends `phaseEndsAt` as an
 * absolute epoch value, and `clockOffset` corrects for a browser clock that
 * disagrees. A refresh, a suspended tab or a mid-phase reconnect therefore all
 * resume with the correct number on screen.
 */
export function useCountdown(
  phaseEndsAt: number | null,
  clockOffset = 0,
  startedAt: number | null = null,
): Countdown {
  const [now, setNow] = useState(() => Date.now());
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (phaseEndsAt === null) return;

    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      setNow(Date.now());
      // A quarter-second cadence is smooth enough for a ticking clock without
      // re-rendering on every animation frame.
      frameRef.current = window.setTimeout(tick, 250);
    };
    tick();

    return () => {
      cancelled = true;
      if (frameRef.current !== null) window.clearTimeout(frameRef.current);
    };
  }, [phaseEndsAt]);

  return useMemo<Countdown>(() => {
    if (phaseEndsAt === null) {
      return { remainingMs: 0, seconds: 0, progress: 0, label: '—', expired: false, active: false };
    }

    const serverNow = now + clockOffset;
    const remainingMs = Math.max(0, phaseEndsAt - serverNow);
    const seconds = Math.ceil(remainingMs / 1000);

    const total = startedAt !== null ? Math.max(1, phaseEndsAt - startedAt) : null;
    const progress = total ? Math.min(1, Math.max(0, 1 - remainingMs / total)) : 0;

    const minutes = Math.floor(seconds / 60);
    const label =
      minutes > 0
        ? `${minutes}:${String(seconds % 60).padStart(2, '0')}`
        : String(seconds).padStart(2, '0');

    return { remainingMs, seconds, progress, label, expired: remainingMs <= 0, active: true };
  }, [phaseEndsAt, clockOffset, now, startedAt]);
}
