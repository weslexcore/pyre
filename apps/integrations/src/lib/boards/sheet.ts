// The arithmetic behind swiping the card drawer closed on a phone: when a
// touch on the sheet becomes a drag rather than a scroll, how far the sheet
// follows the finger, how fast the finger was going at the lift, and whether
// the release dismisses the sheet or lets it settle back. Kept free of React
// and the DOM so it can be tested directly — useSheetSwipe owns the touch
// plumbing.
//
// The sheet is also a scroller, so the gesture has to be read from the scroll
// position: a finger moving down a sheet that is scrolled to its top is
// pulling the sheet closed; the same finger on a sheet scrolled anywhere else
// is scrolling back up. Sideways movement, and any upward movement, is left
// to the browser for the rest of that touch.

/** How far a finger travels before we claim the gesture from the scroller. */
export const SHEET_SLOP = 12;

/** Released this far down the sheet, as a fraction of its height, it closes. */
export const SHEET_CLOSE_FRACTION = 0.3;

/** A flick this fast (px per ms) closes the sheet from almost anywhere. */
export const SHEET_FLICK_VELOCITY = 0.5;

/** Even a flick has to have moved the sheet this far to count. */
export const SHEET_FLICK_MIN = 24;

/** How much of the finger's recent path the lift velocity is read from. */
export const SHEET_VELOCITY_WINDOW_MS = 100;

/** What the gesture has decided so far: nothing yet, ours, or the browser's. */
export type SheetClaim = 'wait' | 'drag' | 'scroll';

/**
 * Whether a touch that has moved (dx, dy) from where it landed is now a drag
 * on the sheet, a scroll (or something else) the browser keeps, or still too
 * short to tell. `scrollTop` is the sheet's own scroll position when the
 * touch landed: a sheet scrolled down is never dragged, it is scrolled.
 */
export function sheetClaim(dx: number, dy: number, scrollTop: number): SheetClaim {
  if (scrollTop > 0) return 'scroll';
  const across = Math.abs(dx);
  // Across beats down, and up is always a scroll: the sheet only moves one way.
  if (across > Math.abs(dy) && across > SHEET_SLOP) return 'scroll';
  if (dy < -SHEET_SLOP) return 'scroll';
  if (dy > SHEET_SLOP) return 'drag';
  return 'wait';
}

/**
 * How far the sheet sits below its resting place for a raw finger delta.
 * Claiming the gesture consumes the slop, so the sheet starts moving from
 * where the finger already is rather than jumping to meet it, and it never
 * goes above its resting place.
 */
export function sheetOffset(dy: number): number {
  return Math.max(0, dy - SHEET_SLOP);
}

/** One point of the finger's path: where it was, and when. */
export interface SheetSample {
  t: number;
  y: number;
}

/**
 * How fast the finger was moving at the lift, in px per ms, positive
 * downward: the movement over roughly the last SHEET_VELOCITY_WINDOW_MS,
 * read from the oldest sample still inside the window. A path too short to
 * measure has no velocity.
 */
export function sheetVelocity(samples: readonly SheetSample[]): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  const start =
    samples.find((sample) => last.t - sample.t <= SHEET_VELOCITY_WINDOW_MS) ?? samples[0];
  if (start === last || last.t <= start.t) return 0;
  return (last.y - start.y) / (last.t - start.t);
}

/**
 * Whether a release with the sheet this far down, moving this fast, closes
 * it. A flick down closes from almost anywhere and a flick up never does;
 * a slow lift is decided by how much of the sheet has gone.
 */
export function sheetShouldClose(offset: number, height: number, velocity: number): boolean {
  if (velocity <= -SHEET_FLICK_VELOCITY) return false;
  if (velocity >= SHEET_FLICK_VELOCITY) return offset >= SHEET_FLICK_MIN;
  return height > 0 && offset >= height * SHEET_CLOSE_FRACTION;
}
