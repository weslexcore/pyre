import { describe, expect, it } from 'vitest';
import {
  EMPTY_LINK_COUNTS,
  type LinkPerformance,
  linkColor,
  matchLink,
  reconcileLinks,
  tagsFromUrl,
} from './link-performance';
import { linkAttributionExpr } from './link-performance-query';

const link = (id: string, content: string): LinkPerformance => ({
  ...EMPTY_LINK_COUNTS,
  id,
  label: id,
  url: null,
  tags: ['instagram', 'social', content, ''],
});
describe('link attribution', () => {
  it('distinguishes variants and refuses duplicate tags or missing attribution', () => {
    const a = link('a', 'bio');
    const b = link('b', 'story');
    expect(matchLink([a, b], ['instagram', 'social', 'story', ''])).toBe(b);
    expect(matchLink([a, link('duplicate', 'bio')], a.tags!)).toBeUndefined();
    expect(matchLink([a], ['', '', '', ''])).toBeUndefined();
    expect(matchLink([a], ['instagram', 'social', '', ''])).toBeUndefined();
  });
  it('matches stored URL tags case-insensitively without omitting content or term', () => {
    expect(
      tagsFromUrl(
        'https://example.com?utm_source=Instagram&utm_medium=Social&utm_content=Story&utm_term=New'
      )
    ).toEqual(['instagram', 'social', 'story', 'new']);
  });
  it('keeps missing credit as unknown so every metric sums to its total', () => {
    const a = { ...link('a', 'bio'), clicks: 10, bookings: 2, memberships: 1 };
    const rows = reconcileLinks([a], {
      ...EMPTY_LINK_COUNTS,
      clicks: 10,
      bookings: 5,
      memberships: 2,
    });
    expect(rows[1]).toMatchObject({ id: 'unknown', bookings: 3, memberships: 1, clicks: 0 });
    expect(a.bookings).toBe(2);
  });
  it('does not claim inconsistent overcounted link credit', () => {
    expect(
      reconcileLinks([{ ...link('a', 'bio'), visitors: 5 }], { ...EMPTY_LINK_COUNTS, visitors: 3 })
    ).toMatchObject([{ visitors: 0 }, { visitors: 3 }]);
  });
  it('keeps link colors stable regardless of activity or report ordering', () => {
    expect(linkColor('a')).toBe(linkColor('a'));
    expect(linkColor('a')).not.toBe(linkColor('b'));
    expect(linkColor('unknown')).toBe('#737373');
  });
  it('uses the campaign attribution origin for every conversion tag', () => {
    const query = linkAttributionExpr('content');
    expect(query).toContain('person.properties.$initial_utm_campaign');
    expect(query).toContain('person.properties.$initial_utm_content');
    expect(query).toContain('properties.attributed_utm_content');
    expect(query).toContain("event = 'booking_attribution_backfill'");
    expect(query).not.toContain('properties.utm_content');
  });
});
