'use client';

import { ROLE_DEFINITIONS, type PublicPlayer } from '@mafia/shared';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/theme';

/**
 * The roster row. One shape for the lobby, the night roster and the day
 * table — only the caption underneath the name changes.
 */
export function PlayerTile({
  player,
  you,
  caption,
  accent,
  actions,
  className,
}: {
  player: PublicPlayer;
  you?: boolean;
  /** Overrides the derived status line. */
  caption?: string | null;
  /** Paint the avatar and caption in the accent. */
  accent?: boolean;
  actions?: React.ReactNode;
  className?: string;
}) {
  const dead = !player.alive && !player.isSpectator;
  const status =
    caption ??
    (dead
      ? player.revealedRole
        ? `Dead · ${ROLE_DEFINITIONS[player.revealedRole].label}`
        : 'Dead'
      : player.isSpectator
        ? 'Spectating'
        : player.isHost
          ? 'Host'
          : !player.connected
            ? 'Reconnecting…'
            : you
              ? 'You'
              : player.ready
                ? 'Ready'
                : 'Alive');

  const highlight = accent || (!dead && !player.connected);

  return (
    <div className={cn('tile', dead && 'tile-dead', className)}>
      <div className={cn('av', accent && 'av-accent')}>{initials(player.name)}</div>
      <div className="min-w-0 flex-1">
        <div className={cn('pname truncate', dead && 'line-through')}>{player.name}</div>
        <div className="lbl mt-0.5 truncate" style={highlight ? { color: 'var(--color-accent)' } : undefined}>
          {status}
        </div>
      </div>
      {actions && <div className="flex shrink-0 gap-1">{actions}</div>}
    </div>
  );
}

/**
 * The tall selection card used for night targets and day votes. The number in
 * the top-right is the live count — Mafia agreement at night, votes by day.
 */
export function TargetCard({
  player,
  selected,
  disabled,
  onSelect,
  count,
  caption,
  you,
}: {
  player: PublicPlayer;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  /** Null hides the counter entirely (secret votes). */
  count?: number | null;
  caption?: string | null;
  you?: boolean;
}) {
  const dead = !player.alive && !player.isSpectator;
  const interactive = !disabled && !dead && onSelect !== undefined;

  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex flex-col gap-3.5 p-[18px] text-left transition-colors',
        dead
          ? 'border border-dashed border-divider opacity-45'
          : selected
            ? 'border-2 border-accent p-[17px]'
            : 'border border-divider',
        interactive && !selected && 'hover:border-accent',
        !interactive && 'cursor-default',
      )}
      style={selected ? { background: 'var(--tint)' } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={cn('av', selected && 'av-accent')}>{initials(player.name)}</div>
        {typeof count === 'number' && (
          <div
            className="text-[34px] font-black leading-none"
            style={{
              color: count > 0 ? (selected ? 'var(--color-accent)' : 'inherit') : 'var(--muted)',
            }}
          >
            {count}
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className={cn('truncate text-[22px] font-extrabold', dead && 'line-through')}>
          {player.name}
          {you && <span className="lbl ml-2 inline">You</span>}
        </div>
        <div
          className="lbl mt-0.5 truncate"
          style={selected ? { color: 'var(--color-accent)' } : undefined}
        >
          {caption ??
            (dead
              ? player.revealedRole
                ? `Dead · ${ROLE_DEFINITIONS[player.revealedRole].label}`
                : 'Dead'
              : selected
                ? 'Selected'
                : 'Select')}
        </div>
      </div>
    </button>
  );
}

/** Three-up on desktop, one-up on a phone — the system's only grid. */
export function TileGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3', className)}>{children}</div>
  );
}
