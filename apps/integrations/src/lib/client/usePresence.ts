import { useEffect, useState } from 'react';

// Enter/exit animation for the header popovers (menu, notifications, search).
// Entry is pure CSS: the `starting:` classes are the @starting-style the
// panel transitions from on its first frame. Exit needs the element to stay
// mounted for the length of the transition, which is what the hook is for —
// after `open` goes false it keeps reporting `mounted` (with `closing` set)
// for PRESENCE_MS, then lets the caller unmount it. Reopening mid-exit just
// drops `closing`, and the transition runs back from wherever it got to.
export const PRESENCE_MS = 150;

export function usePresence(open: boolean, ms = PRESENCE_MS) {
  const [rendered, setRendered] = useState(open);
  // Adjusting state during render (not in an effect) so the panel mounts in
  // the same commit that opens it — callers focus into it from their own
  // effects keyed on `open`.
  if (open && !rendered) setRendered(true);

  useEffect(() => {
    if (open || !rendered) return;
    const timer = setTimeout(() => setRendered(false), ms);
    return () => clearTimeout(timer);
  }, [open, rendered, ms]);

  return { mounted: open || rendered, closing: !open && rendered };
}

/** A panel dropping out of the header: fades and slides down 4px. */
export const DROPDOWN_MOTION =
  'transition duration-150 ease-out starting:-translate-y-1 starting:opacity-0 motion-reduce:transition-none';
export const DROPDOWN_CLOSED = '-translate-y-1 opacity-0';
