import { describe, expect, it } from 'vitest';
import { hoursSince, nextSyncAfter, SYNC_STALE_HOURS } from './schedule';

// All fixtures are UTC instants; ET is UTC-4 in August (EDT) and UTC-5 in
// January (EST), which is exactly what makes the 6am gate worth testing.

describe('nextSyncAfter', () => {
  it('points at this morning when the gate has not opened yet', () => {
    // 03:00 ET on Aug 22 (07:00Z), nothing written today.
    expect(nextSyncAfter('2026-08-22T07:00:00.000Z', '2026-08-21T10:04:00.000Z')).toBe(
      '2026-08-22T10:00:00.000Z' // 06:00 EDT
    );
  });

  it('points at the next hourly tick when the gate is open and today has not run', () => {
    // 09:20 ET on Aug 22 (13:20Z) — the sync should have gone at 6am but the
    // newest write is yesterday's, so it gets another shot at the top of the hour.
    expect(nextSyncAfter('2026-08-22T13:20:00.000Z', '2026-08-21T10:04:00.000Z')).toBe(
      '2026-08-22T14:00:00.000Z'
    );
  });

  it('points at tomorrow morning once today has been written', () => {
    expect(nextSyncAfter('2026-08-22T13:20:00.000Z', '2026-08-22T10:04:00.000Z')).toBe(
      '2026-08-23T10:00:00.000Z'
    );
  });

  it('honors standard time', () => {
    // 03:00 ET on Jan 15 is 08:00Z; 6am EST is 11:00Z, not 10:00Z.
    expect(nextSyncAfter('2026-01-15T08:00:00.000Z', null)).toBe('2026-01-15T11:00:00.000Z');
  });

  it('treats a never-run job as due at the next opportunity', () => {
    expect(nextSyncAfter('2026-08-22T13:20:00.000Z', null)).toBe('2026-08-22T14:00:00.000Z');
  });

  it('never returns the current instant when sitting exactly on a tick', () => {
    const next = nextSyncAfter('2026-08-22T13:00:00.000Z', '2026-08-21T10:04:00.000Z');
    expect(next).toBe('2026-08-22T14:00:00.000Z');
  });

  it('rolls into the next month and year', () => {
    expect(nextSyncAfter('2026-12-31T13:20:00.000Z', '2026-12-31T11:04:00.000Z')).toBe(
      '2027-01-01T11:00:00.000Z' // 06:00 EST
    );
  });
});

describe('hoursSince', () => {
  it('measures elapsed hours', () => {
    expect(hoursSince('2026-08-22T13:00:00.000Z', '2026-08-22T07:00:00.000Z')).toBe(6);
  });

  it('reports a never-run job as infinitely stale', () => {
    expect(hoursSince('2026-08-22T13:00:00.000Z', null)).toBe(Number.POSITIVE_INFINITY);
    expect(hoursSince('2026-08-22T13:00:00.000Z', null) > SYNC_STALE_HOURS).toBe(true);
  });
});
