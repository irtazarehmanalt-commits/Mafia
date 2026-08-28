'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { sound } from '@/lib/sound';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Large, left-aligned label — the primary action on a screen. */
  size?: 'md' | 'lg';
  loading?: boolean;
  block?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading, block, children, onClick, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      onClick={(event) => {
        // Any click is a user gesture, which is the browser's requirement for
        // starting audio — so this is where the sound engine wakes up.
        sound().unlock();
        onClick?.(event);
      }}
      className={cn(
        'btn relative',
        VARIANTS[variant],
        size === 'lg' && 'btn-lg',
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        </span>
      )}
      <span className={cn('inline-flex items-center gap-1.5', loading && 'invisible')}>
        {children}
      </span>
    </button>
  );
});
