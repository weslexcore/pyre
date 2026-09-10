import { describe, expect, it, vi } from 'vitest';
import type { ScheduleLintResolutionRow, ScheduleLintRuleRow } from '@/lib/db';
import {
  defaultRules,
  normalizeNote,
  normalizeParams,
  normalizeSummary,
  resolveRules,
  SUMMARY_MAX,
  summarizeParams,
  toResolution,
} from './registry';
import { BUILT_IN_DEFINITIONS, CUSTOM_DEFINITIONS, definitionFor } from './rules';
import { NOTE_MAX } from './types';

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

  it('parses a typed list of lengths, sorted and de-duplicated', () => {
    const variants = def('duration-variants');
    expect(normalizeParams(variants, { durations: '180, 60, 120, 60' })).toMatchObject({
      ok: true,
      params: expect.objectContaining({ durations: [60, 120, 180] }),
    });
    expect(normalizeParams(variants, { durations: [120, 60] })).toMatchObject({
      ok: true,
      params: expect.objectContaining({ durations: [60, 120] }),
    });
    expect(normalizeParams(variants, { durations: '' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('at least one length'),
    });
    expect(normalizeParams(variants, { durations: '60, abc' })).toMatchObject({ ok: false });
    expect(normalizeParams(variants, { durations: '2' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('at least 5 minutes'),
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
    expect(
      summarizeParams(def('duration-variants'), { type: 'social', durations: [60, 120, 180] })
    ).toContain('Lengths offered: 1 hour, 2 hours, 3 hours');
    expect(CUSTOM_DEFINITIONS.map((d) => d.kind)).toEqual([
      'opening-hours',
      'required-tag',
      'expected-capacity',
      'duration-variants',
    ]);
  });
});

describe('resolutions', () => {
  const row = (over: Partial<ScheduleLintResolutionRow> = {}): ScheduleLintResolutionRow => ({
    key: 'untagged:1',
    rule_id: 'untagged',
    summary: 'No session tag',
    note: null,
    resolved_by: 'wes@pyre.test',
    created_at: '2026-09-14T12:00:00Z',
    last_seen_at: '2026-09-15T12:00:00Z',
    ...over,
  });

  it('maps a row to what the page lists', () => {
    expect(toResolution(row())).toEqual({
      key: 'untagged:1',
      ruleId: 'untagged',
      summary: 'No session tag',
      note: null,
      resolvedBy: 'wes@pyre.test',
      resolvedAt: '2026-09-14T12:00:00Z',
      lastSeenAt: '2026-09-15T12:00:00Z',
    });
  });

  it('falls back to the key when no summary came, and caps both fields', () => {
    expect(normalizeSummary('  ', 'untagged:1')).toBe('untagged:1');
    expect(normalizeSummary(' Under DJ Night ', 'k')).toBe('Under DJ Night');
    expect(normalizeSummary('x'.repeat(400), 'k')).toHaveLength(SUMMARY_MAX);
  });

  it('keeps a note only when one was written', () => {
    expect(normalizeNote('   ')).toBeNull();
    expect(normalizeNote(undefined)).toBeNull();
    expect(normalizeNote('  Intentional  ')).toBe('Intentional');
    expect(normalizeNote('n'.repeat(400))).toHaveLength(NOTE_MAX);
  });
});
