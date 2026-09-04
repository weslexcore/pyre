import { describe, expect, it } from 'vitest';
import { buildArrivalLabel } from './arrival';

// 2026-06-20 10:00–12:00 America/New_York (EDT, UTC-4).
const START = '2026-06-20T14:00:00.000Z';
const END = '2026-06-20T16:00:00.000Z';

describe('buildArrivalLabel', () => {
  it('asks early-arrival sessions to be there 15 minutes before start', () => {
    expect(buildArrivalLabel('early', START, END)).toBe(
      'Please arrive by 9:45 AM to check in and get changed before we begin.'
    );
  });

  it('gives drop-in sessions the first hour as an arrival window', () => {
    expect(buildArrivalLabel('late', START, END)).toBe(
      'Arrive anytime between 10:00 AM and 11:00 AM to check in and get changed.'
    );
  });

  it('caps the drop-in window at the end of a short session', () => {
    const shortEnd = '2026-06-20T14:45:00.000Z';
    expect(buildArrivalLabel('late', START, shortEnd)).toBe(
      'Arrive anytime between 10:00 AM and 10:45 AM to check in and get changed.'
    );
  });

  it('renders in bathhouse time, not UTC', () => {
    // 2026-01-10 18:00 EST (UTC-5).
    expect(buildArrivalLabel('early', '2026-01-10T23:00:00.000Z', '2026-01-11T01:00:00.000Z')).toBe(
      'Please arrive by 5:45 PM to check in and get changed before we begin.'
    );
  });
});
