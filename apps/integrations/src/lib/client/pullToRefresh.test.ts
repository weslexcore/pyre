import { describe, expect, it } from 'vitest';
import {
  PULL_MAX,
  PULL_RESISTANCE,
  PULL_SLOP,
  PULL_THRESHOLD,
  pullClaim,
  pullDistance,
  pullProgress,
  pullShouldRefresh,
} from './pullToRefresh';

describe('pullClaim', () => {
  it('waits until the finger has moved past the slop', () => {
    expect(pullClaim(0, 0, 0)).toBe('wait');
    expect(pullClaim(3, PULL_SLOP, 0)).toBe('wait');
    expect(pullClaim(-3, -PULL_SLOP, 0)).toBe('wait');
  });

  it('claims a downward pull on a page scrolled to its top', () => {
    expect(pullClaim(4, PULL_SLOP + 1, 0)).toBe('pull');
    expect(pullClaim(-20, 60, 0)).toBe('pull');
  });

  it('leaves a page scrolled down to the browser, whichever way the finger goes', () => {
    expect(pullClaim(0, 80, 1)).toBe('scroll');
    expect(pullClaim(0, 80, 400)).toBe('scroll');
  });

  it('leaves upward and sideways movement to the browser', () => {
    expect(pullClaim(0, -(PULL_SLOP + 1), 0)).toBe('scroll');
    expect(pullClaim(PULL_SLOP + 5, PULL_SLOP + 1, 0)).toBe('scroll');
    expect(pullClaim(-(PULL_SLOP + 5), 4, 0)).toBe('scroll');
  });
});

describe('pullDistance', () => {
  it('consumes the slop and never goes above rest', () => {
    expect(pullDistance(-50)).toBe(0);
    expect(pullDistance(PULL_SLOP)).toBe(0);
  });

  it('follows the finger at the resistance', () => {
    expect(pullDistance(PULL_SLOP + 40)).toBe(40 * PULL_RESISTANCE);
  });

  it('stops at the maximum', () => {
    expect(pullDistance(10_000)).toBe(PULL_MAX);
  });
});

describe('pullProgress', () => {
  it('runs from 0 at rest to 1 at the threshold and stays there', () => {
    expect(pullProgress(0)).toBe(0);
    expect(pullProgress(PULL_THRESHOLD / 2)).toBe(0.5);
    expect(pullProgress(PULL_THRESHOLD)).toBe(1);
    expect(pullProgress(PULL_MAX)).toBe(1);
  });
});

describe('pullShouldRefresh', () => {
  it('reloads only once the indicator has reached the threshold', () => {
    expect(pullShouldRefresh(PULL_THRESHOLD - 1)).toBe(false);
    expect(pullShouldRefresh(PULL_THRESHOLD)).toBe(true);
    expect(pullShouldRefresh(PULL_MAX)).toBe(true);
  });

  it('is reachable within the maximum pull', () => {
    expect(PULL_MAX).toBeGreaterThanOrEqual(PULL_THRESHOLD);
    expect(pullShouldRefresh(pullDistance(PULL_SLOP + PULL_THRESHOLD / PULL_RESISTANCE))).toBe(
      true
    );
  });
});
