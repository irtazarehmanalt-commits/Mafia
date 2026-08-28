import Link from 'next/link';
import { cn } from '@/lib/cn';

/**
 * The wordmark. Always uppercase, always tracked out — it reads as a stamp
 * rather than a logotype, which is the point.
 */
export function Logo({
  className,
  href = '/',
  size = 'sm',
}: {
  className?: string;
  href?: string | null;
  size?: 'sm' | 'lg';
}) {
  const text = (
    <span
      className={cn('mark select-none', size === 'lg' && 'text-2xl sm:text-3xl', className)}
    >
      NIGHTFALL
    </span>
  );

  if (!href) return text;
  return (
    <Link href={href} className="text-ink no-underline">
      {text}
    </Link>
  );
}
