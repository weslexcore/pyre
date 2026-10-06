import { describe, expect, it } from 'vitest';
import {
  formatGallons,
  normalizePlungeCreate,
  normalizePlungeOrder,
  normalizePlungePatch,
  plungeName,
  slugifyPlunge,
  uniquePlungeId,
} from './plunges';

describe('plunge ids', () => {
  it('slugs a name', () => {
    expect(slugifyPlunge('Garden Plunge #2')).toBe('garden-plunge-2');
    expect(slugifyPlunge('  Café ')).toBe('cafe');
    expect(slugifyPlunge('!!!')).toBe('');
  });

  it('suffixes a taken id, archived plunges included', () => {
    expect(uniquePlungeId('Left', ['right'])).toBe('left');
    expect(uniquePlungeId('Left', ['left', 'left-2'])).toBe('left-3');
    expect(uniquePlungeId('!!!', [])).toBe('plunge');
  });
});

describe('normalizePlungeCreate', () => {
  it('takes a name and gallons, rounding gallons to one decimal', () => {
    expect(normalizePlungeCreate({ name: '  Garden   plunge ', gallons: '87.54' })).toEqual({
      ok: true,
      value: { name: 'Garden plunge', gallons: 87.5 },
    });
  });

  it('requires a name and a positive volume up to the limit', () => {
    expect(normalizePlungeCreate({ name: '', gallons: 120 }).ok).toBe(false);
    expect(normalizePlungeCreate({ name: 'A', gallons: 0 }).ok).toBe(false);
    expect(normalizePlungeCreate({ name: 'A', gallons: -5 }).ok).toBe(false);
    expect(normalizePlungeCreate({ name: 'A', gallons: 2001 }).ok).toBe(false);
    expect(normalizePlungeCreate({ name: 'A' }).ok).toBe(false);
  });
});

describe('normalizePlungePatch', () => {
  it('touches only the keys sent', () => {
    expect(normalizePlungePatch({ gallons: 90 })).toEqual({ ok: true, value: { gallons: 90 } });
    expect(normalizePlungePatch({ archived: true })).toEqual({
      ok: true,
      value: { archived: true },
    });
  });

  it('rejects blank names, bad volumes, and empty edits', () => {
    expect(normalizePlungePatch({ name: ' ' }).ok).toBe(false);
    expect(normalizePlungePatch({ gallons: 'x' }).ok).toBe(false);
    expect(normalizePlungePatch({ archived: 'yes' }).ok).toBe(false);
    expect(normalizePlungePatch({}).ok).toBe(false);
  });
});

describe('normalizePlungeOrder', () => {
  it('drops unknown and repeated ids', () => {
    expect(normalizePlungeOrder(['b', 'x', 'a', 'b'], ['a', 'b'])).toEqual(['b', 'a']);
    expect(normalizePlungeOrder('a,b', ['a', 'b'])).toBeNull();
    expect(normalizePlungeOrder(['x'], ['a'])).toBeNull();
  });
});

describe('display helpers', () => {
  it('names a plunge, falling back to its id', () => {
    const plunges = [{ id: 'left', name: 'Left' }];
    expect(plungeName(plunges, 'left')).toBe('Left');
    expect(plungeName(plunges, 'gone')).toBe('gone');
  });

  it('formats gallons without a trailing .0', () => {
    expect(formatGallons(120)).toBe('120');
    expect(formatGallons(87.5)).toBe('87.5');
  });
});
