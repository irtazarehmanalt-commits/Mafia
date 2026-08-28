'use client';

import { useEffect, useRef } from 'react';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@mafia/shared';
import { cn } from '@/lib/cn';

/**
 * Six hard-edged character cells. A single hidden input carries the value so
 * paste, autofill and mobile keyboards all behave; the cells are painted from
 * it and the caret cell is marked with the accent.
 */
export function CodeInput({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const cells = Array.from({ length: ROOM_CODE_LENGTH }, (_, i) => value[i] ?? null);
  const caret = Math.min(value.length, ROOM_CODE_LENGTH - 1);

  return (
    <div className="relative">
      <input
        ref={ref}
        value={value}
        onChange={(e) => {
          // Only the unambiguous alphabet, upper-cased, capped at six.
          const next = e.target.value
            .toUpperCase()
            .split('')
            .filter((c) => ROOM_CODE_ALPHABET.includes(c))
            .slice(0, ROOM_CODE_LENGTH)
            .join('');
          onChange(next);
        }}
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="one-time-code"
        spellCheck={false}
        aria-label="Room code"
        className="absolute inset-0 z-10 h-full w-full cursor-text bg-transparent font-mono text-transparent caret-transparent outline-none"
      />
      <div className="flex gap-2 sm:gap-2.5">
        {cells.map((char, i) => {
          const active = i === caret;
          return (
            <div
              key={i}
              className={cn(
                'grid flex-1 place-items-center font-mono font-black',
                'h-[68px] text-[28px] sm:h-24 sm:text-[44px]',
                char !== null
                  ? 'border-2 border-ink'
                  : active
                    ? 'border-2 border-accent text-accent'
                    : 'border-2 border-divider text-neutral-400',
              )}
              style={active ? { outline: '2px solid var(--color-accent)', outlineOffset: 2 } : undefined}
            >
              {char ?? '·'}
            </div>
          );
        })}
      </div>
    </div>
  );
}
