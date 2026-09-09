import { describe, expect, it } from 'vitest';
import { newsletterDefaults } from './newsletter';
import { slugifyCampaign } from './slug';

describe('newsletterDefaults', () => {
  it('names the send by month and spans the calendar month', () => {
    expect(newsletterDefaults(new Date(2026, 8, 9))).toEqual({
      name: 'Newsletter 2026-09',
      startsAt: '2026-09-01',
      endsAt: '2026-09-30',
    });
  });

  it('handles December and leap February', () => {
    expect(newsletterDefaults(new Date(2026, 11, 31)).endsAt).toBe('2026-12-31');
    expect(newsletterDefaults(new Date(2028, 1, 1)).endsAt).toBe('2028-02-29');
  });

  it('slugifies to a sortable campaign id', () => {
    expect(slugifyCampaign(newsletterDefaults(new Date(2026, 0, 15)).name)).toBe(
      'newsletter-2026-01'
    );
  });
});
