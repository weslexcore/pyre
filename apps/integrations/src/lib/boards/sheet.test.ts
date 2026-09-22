import { describe, expect, it } from 'vitest';
import {
  SHEET_CLOSE_FRACTION,
  SHEET_FLICK_MIN,
  SHEET_FLICK_VELOCITY,
  SHEET_SLOP,
  sheetClaim,
  sheetOffset,
  sheetShouldClose,
  sheetVelocity,
} from './sheet';

describe('sheetClaim', () => {
  it('waits until the finger has moved past the slop', () => {
    expect(sheetClaim(0, 0, 0)).toBe('wait');
    expect(sheetClaim(3, SHEET_SLOP, 0)).toBe('wait');
    expect(sheetClaim(-3, -SHEET_SLOP, 0)).toBe('wait');
  });

  it('claims a downward pull on a sheet scrolled to its top', () => {
    expect(sheetClaim(4, SHEET_SLOP + 1, 0)).toBe('drag');
    expect(sheetClaim(-20, 60, 0)).toBe('drag');
  });

  it('leaves a sheet scrolled down to the scroller, whichever way the finger goes', () => {
    expect(sheetClaim(0, 80, 1)).toBe('scroll');
    expect(sheetClaim(0, 80, 400)).toBe('scroll');
  });

  it('leaves upward and sideways movement to the browser', () => {
    expect(sheetClaim(0, -(SHEET_SLOP + 1), 0)).toBe('scroll');
    expect(sheetClaim(SHEET_SLOP + 1, 4, 0)).toBe('scroll');
    expect(sheetClaim(-(SHEET_SLOP + 1), -2, 0)).toBe('scroll');
  });
});

describe('sheetOffset', () => {
  it('starts from where the finger already is, consuming the slop', () => {
    expect(sheetOffset(SHEET_SLOP)).toBe(0);
    expect(sheetOffset(SHEET_SLOP + 30)).toBe(30);
  });

  it('never lifts the sheet above its resting place', () => {
    expect(sheetOffset(0)).toBe(0);
    expect(sheetOffset(-50)).toBe(0);
  });
});

describe('sheetVelocity', () => {
  it('has no velocity for a path too short to measure', () => {
    expect(sheetVelocity([])).toBe(0);
    expect(sheetVelocity([{ t: 0, y: 0 }])).toBe(0);
    expect(
      sheetVelocity([
        { t: 5, y: 0 },
        { t: 5, y: 40 },
      ])
    ).toBe(0);
  });

  it('reads the movement over the recent window only', () => {
    const samples = [
      { t: 0, y: 0 },
      { t: 500, y: 10 }, // an early slow stretch, outside the window
      { t: 550, y: 40 },
      { t: 600, y: 90 },
    ];
    // From t=500 (the oldest sample within 100ms of the lift): 80px in 100ms.
    expect(sheetVelocity(samples)).toBeCloseTo(0.8);
  });

  it('is negative when the finger was moving back up at the lift', () => {
    expect(
      sheetVelocity([
        { t: 0, y: 200 },
        { t: 50, y: 150 },
      ])
    ).toBe(-1);
  });
});

describe('sheetShouldClose', () => {
  const height = 600;

  it('closes on a slow lift once enough of the sheet has gone', () => {
    const line = height * SHEET_CLOSE_FRACTION;
    expect(sheetShouldClose(line - 1, height, 0)).toBe(false);
    expect(sheetShouldClose(line, height, 0)).toBe(true);
  });

  it('closes on a flick down from almost anywhere', () => {
    expect(sheetShouldClose(SHEET_FLICK_MIN, height, SHEET_FLICK_VELOCITY)).toBe(true);
    expect(sheetShouldClose(SHEET_FLICK_MIN - 1, height, SHEET_FLICK_VELOCITY * 2)).toBe(false);
  });

  it('stays when the finger was flicking back up, however far down it got', () => {
    expect(sheetShouldClose(height * 0.9, height, -SHEET_FLICK_VELOCITY)).toBe(false);
  });

  it('cannot decide by fraction on a sheet with no height', () => {
    expect(sheetShouldClose(100, 0, 0)).toBe(false);
  });
});
