// The arithmetic behind pull-to-refresh: when a touch at the top of the page
// becomes a pull rather than a scroll, how far the indicator follows the
// finger, and whether the release reloads the page. Kept free of the DOM so
// it can be tested directly — components/PullToRefresh.astro owns the touch
// plumbing.
//
// The admin is installed as a standalone app on staff phones, where there is
// no browser chrome and so no native pull-to-refresh; this puts it back, on
// every page, in browsers and the installed app alike.

/** How far a finger travels before we claim the gesture from the scroller. */
export const PULL_SLOP = 10;

/** The indicator moves this fraction of the finger's travel — the rubber band. */
export const PULL_RESISTANCE = 0.5;

/** Released with the indicator this far down, the page reloads. */
export const PULL_THRESHOLD = 64;

/** The indicator never travels further than this, however far the finger goes. */
export const PULL_MAX = 112;

/** What the gesture has decided so far: nothing yet, ours, or the browser's. */
export type PullClaim = 'wait' | 'pull' | 'scroll';

/**
 * Whether a touch that has moved (dx, dy) from where it landed is now a pull,
 * a scroll (or something else) the browser keeps, or still too short to
 * tell. `scrollTop` is the page's scroll position when the touch landed: a
 * page scrolled down is never pulled, it is scrolled.
 */
export function pullClaim(dx: number, dy: number, scrollTop: number): PullClaim {
  if (scrollTop > 0) return 'scroll';
  const across = Math.abs(dx);
  // Across beats down, and up is always a scroll: the pull only goes one way.
  if (across > Math.abs(dy) && across > PULL_SLOP) return 'scroll';
  if (dy < -PULL_SLOP) return 'scroll';
  if (dy > PULL_SLOP) return 'pull';
  return 'wait';
}

/**
 * How far the indicator sits below its resting place for a raw finger delta.
 * Claiming consumes the slop so the indicator starts from where the finger
 * already is; past that it follows at PULL_RESISTANCE, up to PULL_MAX.
 */
export function pullDistance(dy: number): number {
  return Math.min(PULL_MAX, Math.max(0, dy - PULL_SLOP) * PULL_RESISTANCE);
}

/** How close a pull is to reloading, 0 to 1 — drives the arrow's turn. */
export function pullProgress(distance: number): number {
  return Math.min(1, Math.max(0, distance / PULL_THRESHOLD));
}

/** Whether letting go with the indicator this far down reloads the page. */
export function pullShouldRefresh(distance: number): boolean {
  return distance >= PULL_THRESHOLD;
}
