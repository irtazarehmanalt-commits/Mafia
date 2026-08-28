'use client';

import { cn } from '@/lib/cn';
import { useGame } from '../GameProvider';

/** Transient notices — deaths, investigation results, arrivals. */
export function Toasts() {
  const { toasts, dismissToast } = useGame();
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[74px] z-40 flex flex-col items-center gap-2 px-4">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => dismissToast(toast.id)}
          className={cn(
            'pointer-events-auto max-w-md animate-rise-in border-2 px-4 py-2.5 text-left text-sm font-semibold shadow-lg',
          )}
          style={
            toast.tone === 'danger'
              ? {
                  borderColor: 'var(--color-accent)',
                  background: 'var(--color-accent)',
                  color: 'var(--color-bg)',
                }
              : {
                  borderColor: 'var(--color-text)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                }
          }
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}

/** Persistent bar while the socket is down. */
export function ConnectionBanner() {
  const { status } = useGame();
  if (status === 'connected' || status === 'idle') return null;

  const copy =
    status === 'reconnecting'
      ? 'Connection lost. Reconnecting…'
      : status === 'connecting'
        ? 'Connecting…'
        : null;
  if (!copy) return null;

  return (
    <div
      className="lbl sticky top-0 z-50 py-2 text-center"
      style={{ background: 'var(--color-accent)', color: '#fff' }}
    >
      <span className="mr-2 inline-block h-1.5 w-1.5 animate-bar-pulse rounded-full bg-white align-middle" />
      {copy}
    </div>
  );
}

/** The public, already-redacted game log. */
export function EventLog({
  className,
  limit = 14,
}: {
  className?: string;
  limit?: number;
}) {
  const { state } = useGame();
  if (!state) return null;

  const events = [...state.events].reverse().slice(0, limit);

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <p className="lbl mb-3.5">Event log · public</p>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-divider">
        {events.length === 0 && <p className="lbl py-3">Nothing has happened yet.</p>}
        {events.map((event) => (
          <div
            key={event.id}
            className="border-b border-divider py-3 text-sm"
            style={
              event.visibility === 'PRIVATE' ? { color: 'var(--color-accent)' } : undefined
            }
          >
            <span className="mono mr-2.5 text-muted">
              {event.day > 0 ? `D${event.day}` : '—'}
            </span>
            {event.message}
          </div>
        ))}
      </div>
    </div>
  );
}
