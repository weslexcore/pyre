// The arithmetic behind swiping a checklist row: which action a drag would
// commit, how far the row travels for a given finger delta, and when the drag
// has gone far enough to count. Kept free of React and the DOM so it can be
// tested directly — useRowSwipe owns the pointer plumbing.
//
// The gesture mirrors the two controls already on a row: right completes an
// item, left skips it. On a row that is already resolved the *opposite*
// direction un-resolves it (the way it came), and the direction it was
// resolved by does nothing. An item the document marks required has no Skip
// control, so it has no skip swipe either — the only way past it is to do it.

export type SwipeAction = 'complete' | 'skip' | 'undo';

/** The row as the gesture sees it. */
export interface SwipeRow {
  checked: boolean;
  /** Explicitly skipped — resolved, but not done. */
  skipped: boolean;
  /** False for a required item: it can be completed, never skipped. */
  skippable: boolean;
}

/** How far a finger travels before we claim the gesture from the page scroller. */
export const SWIPE_SLOP = 12;

/** How far it has to travel for a release to commit the action. */
export const SWIPE_THRESHOLD = 72;

/** How far a row can rubber-band in a direction that does nothing. */
const DEAD_TRAVEL = 28;

/** Past the threshold, the row keeps moving but at a fraction of the finger. */
const OVERSHOOT = 0.35;

/**
 * The action a release at this delta would commit, or null when this direction
 * does nothing for this row (a completed row swiped right, a skipped row
 * swiped left, or no movement at all).
 */
export function swipeAction(row: SwipeRow, dx: number): SwipeAction | null {
  if (dx === 0) return null;
  const right = dx > 0;
  // A skipped row keeps its undo even when the item has since been marked
  // required, the same way the row keeps its Undo control.
  if (row.checked) return right ? null : 'undo';
  if (row.skipped) return right ? 'undo' : null;
  if (right) return 'complete';
  return row.skippable ? 'skip' : null;
}

/**
 * How far the row should actually move for a raw finger delta. A live
 * direction tracks the finger 1:1 up to the threshold and then drags behind
 * it; a dead one barely moves, approaching DEAD_TRAVEL but never reaching it,
 * so the row feels alive without ever looking like it will do something.
 */
export function swipeOffset(dx: number, live: boolean): number {
  const sign = Math.sign(dx);
  const distance = Math.abs(dx);
  if (!live) return sign * DEAD_TRAVEL * (1 - 1 / (1 + distance / DEAD_TRAVEL));
  if (distance <= SWIPE_THRESHOLD) return dx;
  return sign * (SWIPE_THRESHOLD + (distance - SWIPE_THRESHOLD) * OVERSHOOT);
}

/** Whether a drag this far would commit on release. */
export function swipeArmed(dx: number): boolean {
  return Math.abs(dx) >= SWIPE_THRESHOLD;
}
