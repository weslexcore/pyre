import { describe, expect, it, vi } from 'vitest';
import type { ScheduleLintRuleRow } from '@/lib/db';
import { defaultRules, normalizeParams, resolveRules, summarizeParams } from './registry';
import { BUILT_IN_DEFINITIONS, CUSTOM_DEFINITIONS, definitionFor } from './rules';

const row = (over: Partial<ScheduleLintRuleRow>): ScheduleLintRuleRow => ({
  id: 'r1',
  kind: 'required-tag',
  label: 'Socials carry the tag',
  enabled: true,
  params: { titleContains: 'Social', tag: 'Social' },
  updated_by: 'wes@pyre.test',
  created_at: '2026-09-10T12:00:00Z',
  updated_at: '2026-09-10T12:00:00Z',
  ...over,
});

const def = (kind: string) => {
  const d = definitionFor(kind);
  if (!d) throw new Error(`no definition for ${kind}`);
  return d;
};

describe('normalizeParams', () => {
  it('fills missing settings from the defaults and rejects wrong ones by name', () => {
    expect(normalizeParams(def('draft-soon'), {})).toEqual({ ok: true, params: { days: 7 } });
    expect(normalizeParams(def('draft-soon'), { days: '10' })).toEqual({
      ok: true,
      params: { days: 10 },
    });
    expect(normalizeParams(def('draft-soon'), { days: 0 })).toMatchObject({
      ok: false,
      error: expect.stringContaining('at least 1'),
    });
    expect(normalizeParams(def('draft-soon'), { days: 2.5 })).toMatchObject({ ok: false });
  });

  it('lowercases and de-duplicates session types, refusing unknown ones', () => {
    const overlap = def('special-event-overlap');
    expect(normalizeParams(overlap, { cancelTypes: ['Open Hours', 'social', 'social'] })).toEqual({
      ok: true,
      params: { cancelTypes: ['open hours', 'social'] },
    });
    expect(normalizeParams(overlap, { cancelTypes: ['massage'] })).toMatchObject({
      ok: false,
      error: expect.stringContaining('unknown type'),
    });
    expect(normalizeParams(def('expected-capacity'), { type: 'Guided' })).toMatchObject({
      ok: true,
      params: expect.objectContaining({ type: 'guided' }),
    });
  });

  it('validates a week of opening hours', () => {
    const hours = def('opening-hours');
    const ok = normalizeParams(hours, {
      days: { wed: { open: '16:00', close: '20:00' }, sat: '' },
      types: [],
    });
    expect(ok).toMatchObject({
      ok: true,
      params: {
        days: {
          sun: null,
          mon: null,
          tue: null,
          wed: { open: '16:00', close: '20:00' },
          thu: null,
          fri: null,
          sat: null,
        },
      },
    });
    expect(
      normalizeParams(hours, { days: { wed: { open: '4pm', close: '20:00' } } })
    ).toMatchObject({
      ok: false,
      error: 'Wed: opening time must be HH:MM',
    });
    expect(
      normalizeParams(hours, { days: { wed: { open: '20:00', close: '16:00' } } })
    ).toMatchObject({
      ok: false,
      error: 'Wed: closing time must be after opening time',
    });
  });

  it('requires text unless the field says otherwise', () => {
    expect(
      normalizeParams(def('required-tag'), { titleContains: '  ', tag: 'Social' })
    ).toMatchObject({ ok: false, error: 'When the title contains is required' });
  });
});

describe('resolveRules', () => {
  it('lists every built-in, enabled with defaults, when nothing is saved', () => {
    const rules = resolveRules([]);
    expect(rules).toEqual(defaultRules());
    expect(rules.map((r) => r.kind)).toEqual(BUILT_IN_DEFINITIONS.map((d) => d.kind));
    expect(rules.every((r) => r.enabled && r.builtIn && r.id === r.kind)).toBe(true);
  });

  it('applies a built-in override row and appends custom rows in creation order', () => {
    const rules = resolveRules([
      row({ id: 'r2', created_at: '2026-09-11T00:00:00Z', label: 'Later' }),
      row({
        id: 'draft-soon',
        kind: 'draft-soon',
        label: 'Drafts',
        enabled: false,
        params: { days: 3 },
      }),
      row({ id: 'r1' }),
    ]);
    const draft = rules.find((r) => r.id === 'draft-soon');
    expect(draft).toMatchObject({
      enabled: false,
      params: { days: 3 },
      label: 'Drafts',
      builtIn: true,
    });
    expect(rules.filter((r) => !r.builtIn).map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(rules.find((r) => r.id === 'r1')).toMatchObject({
      kind: 'required-tag',
      label: 'Socials carry the tag',
      params: { titleContains: 'Social', tag: 'Social' },
    });
  });

  it('skips rows it cannot run, and falls back to defaults for a built-in with bad settings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rules = resolveRules([
      row({ id: 'r1', kind: 'not-a-rule' }),
      row({ id: 'r2', params: { titleContains: '', tag: 'x' } }),
      row({ id: 'capacity-outlier', kind: 'capacity-outlier', params: { minGroup: 'lots' } }),
    ]);
    expect(rules.filter((r) => !r.builtIn)).toEqual([]);
    expect(rules.find((r) => r.id === 'capacity-outlier')?.params).toEqual({ minGroup: 6 });
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});

describe('summarizeParams', () => {
  it('describes each kind of setting in a line', () => {
    expect(summarizeParams(def('draft-soon'), { days: 7 })).toBe(
      'Flag drafts starting within (days): 7'
    );
    expect(summarizeParams(def('special-event-overlap'), { cancelTypes: [] })).toBe(
      'Mark these types cancel: any'
    );
    expect(
      summarizeParams(def('opening-hours'), {
        days: {
          sun: null,
          mon: null,
          tue: null,
          wed: { open: '16:00', close: '20:00' },
          thu: null,
          fri: null,
          sat: { open: '10:00', close: '16:00' },
        },
        types: ['open hours'],
      })
    ).toBe('Wed 4:00 PM–8:00 PM · Sat 10:00 AM–4:00 PM · Only check these types: open hours');
    expect(CUSTOM_DEFINITIONS.map((d) => d.kind)).toEqual([
      'opening-hours',
      'required-tag',
      'expected-capacity',
    ]);
  });
});
