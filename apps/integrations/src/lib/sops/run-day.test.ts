import { describe, expect, it } from 'vitest';
import { isStaleRun, studioDayStart } from './run-day';

const at = (iso: string) => new Date(iso);

describe('studioDayStart', () => {
  it('is midnight Eastern, still the previous UTC evening before it', () => {
    // 11:30pm EDT on Oct 6 is already Oct 7 in UTC.
    expect(studioDayStart(at('2026-10-07T03:30:00.000Z'))).toBe('2026-10-06T04:00:00.000Z');
    expect(studioDayStart(at('2026-10-07T04:30:00.000Z'))).toBe('2026-10-07T04:00:00.000Z');
  });

  it('follows the clock change to standard time', () => {
    expect(studioDayStart(at('2026-11-02T15:00:00.000Z'))).toBe('2026-11-02T05:00:00.000Z');
  });
});

describe('isStaleRun', () => {
  const evening = { status: 'in_progress' as const, started_at: '2026-10-06T22:00:00.000Z' };

  it('keeps a run open through the rest of its studio day', () => {
    expect(isStaleRun(evening, at('2026-10-07T03:59:00.000Z'))).toBe(false);
  });

  it('treats the run as stale once the studio day turns over', () => {
    expect(isStaleRun(evening, at('2026-10-07T04:01:00.000Z'))).toBe(true);
  });

  it('never calls a finished run stale', () => {
    for (const status of ['completed', 'abandoned'] as const) {
      expect(isStaleRun({ ...evening, status }, at('2026-10-09T12:00:00.000Z'))).toBe(false);
    }
  });
});
