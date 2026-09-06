import { describe, expect, it } from 'vitest';
import type { GuestProfileFieldRow } from '@/lib/db';
import {
  coerceAnswer,
  mergeAnswers,
  normalizeFieldCreate,
  normalizeFieldPatch,
  normalizeMemberId,
  normalizeNoteBody,
  normalizeOptions,
  normalizeOrder,
  normalizeSummary,
  slugifyKey,
} from './validate';

const field = (
  overrides: Partial<GuestProfileFieldRow> & Pick<GuestProfileFieldRow, 'key' | 'kind'>
): GuestProfileFieldRow => ({
  label: overrides.key,
  options: [],
  section: 'About them',
  hint: null,
  show_on_roster: false,
  sort_order: 0,
  archived: false,
  created_by: null,
  updated_by: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  ...overrides,
});

const heat = field({ key: 'heat', kind: 'choice', options: ['Gentle', 'Medium', 'Hot'] });
const scents = field({
  key: 'scents',
  kind: 'multi_choice',
  options: ['Eucalyptus', 'Lavender', 'Birch'],
});
const reason = field({ key: 'reason', kind: 'text' });
const temp = field({ key: 'temp', kind: 'number' });
const towel = field({ key: 'towel', kind: 'yes_no' });

describe('slugifyKey', () => {
  it('turns a label into a permanent key', () => {
    expect(slugifyKey('Scents they enjoy')).toBe('scents_they_enjoy');
    expect(slugifyKey('  Löyly / steam?  ')).toBe('loyly_steam');
  });

  it('never starts a key with a digit', () => {
    expect(slugifyKey('5k runners')).toBe('f_5k_runners');
  });

  it('gives up on a label with nothing usable in it', () => {
    expect(slugifyKey('???')).toBe('');
  });
});

describe('normalizeOptions', () => {
  it('accepts a list or one-per-line text, trimmed and de-duplicated', () => {
    expect(normalizeOptions(' Hot \nMedium\nhot\n\nGentle')).toEqual(['Hot', 'Medium', 'Gentle']);
    expect(normalizeOptions(['A', 'a', ' B '])).toEqual(['A', 'B']);
  });
});

describe('normalizeFieldCreate', () => {
  it('needs a label', () => {
    expect(normalizeFieldCreate({ kind: 'text' })).toMatchObject({ ok: false });
  });

  it('derives the key from the label and defaults to short text', () => {
    const result = normalizeFieldCreate({ label: 'Favourite tea' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      key: 'favourite_tea',
      kind: 'text',
      options: [],
      section: 'About them',
      show_on_roster: false,
    });
  });

  it('requires at least two options for a pick list', () => {
    expect(
      normalizeFieldCreate({ label: 'Heat', kind: 'choice', options: ['Only one'] })
    ).toMatchObject({ ok: false });
    const ok = normalizeFieldCreate({
      label: 'Heat',
      kind: 'choice',
      options: 'Gentle\nHot',
      showOnRoster: true,
      section: 'In the sauna',
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.value.options).toEqual(['Gentle', 'Hot']);
    expect(ok.value.show_on_roster).toBe(true);
    expect(ok.value.section).toBe('In the sauna');
  });

  it('drops options handed to a kind that has none', () => {
    const result = normalizeFieldCreate({ label: 'Notes', kind: 'text', options: ['a', 'b'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.options).toEqual([]);
  });

  it('rejects a malformed explicit key', () => {
    expect(normalizeFieldCreate({ label: 'Heat', key: 'Heat Level' })).toMatchObject({ ok: false });
  });
});

describe('normalizeFieldPatch', () => {
  it('only touches what the body names', () => {
    const result = normalizeFieldPatch({ label: 'Heat level', archived: true }, { kind: 'choice' });
    expect(result).toEqual({ ok: true, value: { label: 'Heat level', archived: true } });
  });

  it("won't give options to a text field", () => {
    expect(normalizeFieldPatch({ options: ['a', 'b'] }, { kind: 'text' })).toMatchObject({
      ok: false,
    });
  });

  it('has to change something', () => {
    expect(normalizeFieldPatch({ kind: 'number' }, { kind: 'text' })).toMatchObject({ ok: false });
  });
});

describe('coerceAnswer', () => {
  it('matches a choice against the offered options, case-insensitively', () => {
    expect(coerceAnswer(heat, 'hot')).toBe('Hot');
    expect(coerceAnswer(heat, 'Scorching')).toBeNull();
  });

  it('keeps a multi-choice in the field’s own order without duplicates', () => {
    expect(coerceAnswer(scents, ['Birch', 'eucalyptus', 'Birch', 'Rose'])).toEqual([
      'Eucalyptus',
      'Birch',
    ]);
    expect(coerceAnswer(scents, [])).toBeNull();
  });

  it('understands the ways a yes/no arrives', () => {
    expect(coerceAnswer(towel, true)).toBe(true);
    expect(coerceAnswer(towel, 'no')).toBe(false);
    expect(coerceAnswer(towel, 'maybe')).toBeNull();
  });

  it('coerces numbers and trims text', () => {
    expect(coerceAnswer(temp, '190')).toBe(190);
    expect(coerceAnswer(temp, 'hot')).toBeNull();
    expect(coerceAnswer(reason, '  sleep  ')).toBe('sleep');
    expect(coerceAnswer(reason, '   ')).toBeNull();
  });
});

describe('mergeAnswers', () => {
  const fields = [heat, scents, reason];

  it('overwrites named keys, keeps the rest, and drops unknown ones', () => {
    const current = { heat: 'Hot', reason: 'sleep' };
    const next = mergeAnswers(fields, current, { scents: ['Birch'], bogus: 'x' });
    expect(next).toEqual({ heat: 'Hot', reason: 'sleep', scents: ['Birch'] });
  });

  it('clears an answer when the body blanks it', () => {
    expect(mergeAnswers(fields, { heat: 'Hot' }, { heat: '' })).toEqual({});
    expect(mergeAnswers(fields, { heat: 'Hot' }, { heat: null })).toEqual({});
  });

  it('ignores a body that is not an object', () => {
    expect(mergeAnswers(fields, { heat: 'Hot' }, 'nope')).toEqual({ heat: 'Hot' });
  });
});

describe('summary, notes, ids, order', () => {
  it('blank summary stores as null; long ones are refused', () => {
    expect(normalizeSummary('   ')).toEqual({ ok: true, value: null });
    expect(normalizeSummary('x'.repeat(501))).toMatchObject({ ok: false });
  });

  it('a note has to say something', () => {
    expect(normalizeNoteBody('  ')).toMatchObject({ ok: false });
    expect(normalizeNoteBody(' Loves the birch ')).toEqual({ ok: true, value: 'Loves the birch' });
  });

  it('member ids are digits only', () => {
    expect(normalizeMemberId(12345)).toBe('12345');
    expect(normalizeMemberId(' 987 ')).toBe('987');
    expect(normalizeMemberId('12; drop table')).toBeNull();
  });

  it('a reorder keeps only known keys, once each', () => {
    expect(normalizeOrder(['b', 'a', 'b', 'zz'], ['a', 'b', 'c'])).toEqual(['b', 'a']);
    expect(normalizeOrder('a,b', ['a'])).toBeNull();
  });
});
