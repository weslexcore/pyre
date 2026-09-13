import { describe, expect, it } from 'vitest';
import { SWIPE_THRESHOLD, type SwipeRow, swipeAction, swipeArmed, swipeOffset } from './swipe';

const OPEN: SwipeRow = { checked: false, skipped: false, skippable: true };
const REQUIRED: SwipeRow = { checked: false, skipped: false, skippable: false };
const CHECKED: SwipeRow = { checked: true, skipped: false, skippable: true };
const SKIPPED: SwipeRow = { checked: false, skipped: true, skippable: true };

describe('swipeAction', () => {
  it('completes to the right and skips to the left on an open item', () => {
    expect(swipeAction(OPEN, 40)).toBe('complete');
    expect(swipeAction(OPEN, -40)).toBe('skip');
  });

  it('has no skip for a required item, only the complete swipe', () => {
    expect(swipeAction(REQUIRED, 40)).toBe('complete');
    expect(swipeAction(REQUIRED, -40)).toBeNull();
  });

  it('un-resolves in the direction opposite the one that resolved it', () => {
    expect(swipeAction(CHECKED, -40)).toBe('undo');
    expect(swipeAction(SKIPPED, 40)).toBe('undo');
  });

  it('does nothing when swiped the way the item was already resolved', () => {
    expect(swipeAction(CHECKED, 40)).toBeNull();
    expect(swipeAction(SKIPPED, -40)).toBeNull();
  });

  it('keeps undo on an item skipped before it was marked required', () => {
    expect(swipeAction({ checked: false, skipped: true, skippable: false }, 40)).toBe('undo');
  });

  it('has nothing to do at rest', () => {
    expect(swipeAction(OPEN, 0)).toBeNull();
  });
});

describe('swipeArmed', () => {
  it('commits only once the drag reaches the threshold, either way', () => {
    expect(swipeArmed(SWIPE_THRESHOLD - 1)).toBe(false);
    expect(swipeArmed(SWIPE_THRESHOLD)).toBe(true);
    expect(swipeArmed(-SWIPE_THRESHOLD)).toBe(true);
  });
});

describe('swipeOffset', () => {
  it('tracks the finger up to the threshold', () => {
    expect(swipeOffset(30, true)).toBe(30);
    expect(swipeOffset(-30, true)).toBe(-30);
    expect(swipeOffset(SWIPE_THRESHOLD, true)).toBe(SWIPE_THRESHOLD);
  });

  it('drags behind the finger past the threshold', () => {
    const past = swipeOffset(SWIPE_THRESHOLD + 100, true);
    expect(past).toBeGreaterThan(SWIPE_THRESHOLD);
    expect(past).toBeLessThan(SWIPE_THRESHOLD + 100);
  });

  it('barely moves, and never arms, in a direction that does nothing', () => {
    const dead = swipeOffset(-400, false);
    expect(dead).toBeLessThan(0);
    expect(Math.abs(dead)).toBeLessThan(28);
    expect(swipeArmed(dead)).toBe(false);
  });

  it('stays put at rest', () => {
    expect(swipeOffset(0, true)).toBe(0);
    expect(swipeOffset(0, false)).toBe(0);
  });
});
