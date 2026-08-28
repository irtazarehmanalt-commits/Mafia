'use client';

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? (
        <span className="mt-1.5 block text-xs" style={{ color: 'var(--color-accent-700)' }}>
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs text-muted">{hint}</span>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn('input', className)} {...rest} />;
  },
);

/**
 * Segmented control. The system has no toggle switch — a two-option segment
 * does that job, which keeps every setting the same shape.
 */
export function Segment<T extends string | number>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('seg', className)} role="group">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className="seg-opt"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Convenience wrapper for the very common on/off case. */
export function OnOff({
  value,
  onChange,
  labels = ['Off', 'On'],
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  labels?: [string, string];
}) {
  return (
    <Segment<'off' | 'on'>
      value={value ? 'on' : 'off'}
      onChange={(next) => onChange(next === 'on')}
      options={[
        { value: 'off', label: labels[0] },
        { value: 'on', label: labels[1] },
      ]}
    />
  );
}

/** A labelled row with a control on the right, separated by a hairline. */
export function SettingRow({
  label,
  children,
  note,
}: {
  label: string;
  children: ReactNode;
  note?: string;
}) {
  return (
    <div className="kv">
      <span className="min-w-0">
        <span className="block text-[15px]">{label}</span>
        {note && <span className="mt-0.5 block text-xs text-muted">{note}</span>}
      </span>
      <span className="shrink-0">{children}</span>
    </div>
  );
}
