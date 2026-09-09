import { describe, expect, it } from 'vitest';
import { CUSTOM_PLACEMENT_KEY, PLACEMENT_GROUPS, PLACEMENTS, placementByKey } from './placements';

const UTM_SAFE = /^[a-z0-9_-]*$/;

describe('placement catalog', () => {
  it('has unique keys', () => {
    const keys = PLACEMENTS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('only uses utm-safe values', () => {
    for (const p of PLACEMENTS) {
      expect(p.source, p.key).toMatch(UTM_SAFE);
      expect(p.medium, p.key).toMatch(UTM_SAFE);
      expect(p.content, p.key).toMatch(UTM_SAFE);
    }
  });

  it('locks source, medium, and content on every standard placement', () => {
    for (const p of PLACEMENTS.filter((p) => !p.custom)) {
      // askSource placements derive utm_source from the input; the default
      // still has to be a real value so nothing can ship blank.
      expect(p.source, p.key).not.toBe('');
      expect(p.medium, p.key).not.toBe('');
      expect(p.content, p.key).not.toBe('');
      expect(p.hint, p.key).not.toBe('');
    }
  });

  it('has exactly one custom placement, listed last', () => {
    const custom = PLACEMENTS.filter((p) => p.custom);
    expect(custom).toHaveLength(1);
    expect(PLACEMENTS.at(-1)?.key).toBe(CUSTOM_PLACEMENT_KEY);
    expect(placementByKey(CUSTOM_PLACEMENT_KEY)?.custom).toBe(true);
  });

  it('files every placement under a labelled group', () => {
    const groups = new Set(PLACEMENT_GROUPS.map((g) => g.key));
    for (const p of PLACEMENTS) expect(groups.has(p.group), p.key).toBe(true);
  });
});
