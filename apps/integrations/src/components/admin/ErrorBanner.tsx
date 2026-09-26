import type { ReactNode } from 'react';

/**
 * The red box an island shows when a load or save fails. `mono` is the
 * smaller monospace version the dense tools (schedule, business) use.
 */
export function ErrorBanner({
  children,
  mono = false,
  className = '',
}: {
  children: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <p
      role="alert"
      className={`rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 ${
        mono ? 'font-mono text-xs' : 'text-sm'
      } text-[var(--pyre-red)] ${className}`.trim()}
    >
      {children}
    </p>
  );
}
