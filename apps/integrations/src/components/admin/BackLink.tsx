// The one back link every admin page uses to return to the list it came
// from: a bordered toolbar button reading "← All SOPs", "← All boards", and
// so on. Pages sit it first in their toolbar row. Keep new back links on
// this component rather than restyling an <a>, so they all stay alike.
import type { ReactNode } from 'react';

/** For the rare back control that is a button (the SOP peek modal's history). */
export const backLinkClass =
  'inline-flex shrink-0 items-center gap-1.5 rounded border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-white/70 transition-colors hover:border-white/30 hover:text-white disabled:opacity-40';

export function BackLink({
  href,
  children,
  className,
}: {
  href: string;
  /** Where it goes, without the arrow: "All SOPs". */
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      data-astro-prefetch
      className={className ? `${backLinkClass} ${className}` : backLinkClass}
    >
      <span aria-hidden="true">←</span>
      {children}
    </a>
  );
}
