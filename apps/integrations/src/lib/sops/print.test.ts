import { describe, expect, it } from 'vitest';
import { MAX_PRINT_SOPS, parsePrintSlugs, printFooter, sopPrintHref } from './print';

describe('parsePrintSlugs', () => {
  it('reads a comma-separated list in order', () => {
    expect(parsePrintSlugs('closing,opening-a')).toEqual(['closing', 'opening-a']);
  });

  it('round-trips the href the library builds', () => {
    const href = sopPrintHref(['set-up-a', 'close-down']);
    const param = new URL(href, 'https://x.test').searchParams.get('slugs');
    expect(parsePrintSlugs(param)).toEqual(['set-up-a', 'close-down']);
  });

  it('drops blanks, duplicates and anything that is not a slug', () => {
    expect(parsePrintSlugs(' a , ,b,a,../etc,C ')).toEqual(['a', 'b', 'c']);
  });

  it('is empty for a missing param', () => {
    expect(parsePrintSlugs(null)).toEqual([]);
  });

  it('caps the list', () => {
    const many = Array.from({ length: MAX_PRINT_SOPS + 5 }, (_, i) => `s${i}`).join(',');
    expect(parsePrintSlugs(many)).toHaveLength(MAX_PRINT_SOPS);
  });
});

describe('printFooter', () => {
  const sop = {
    current_version: 7,
    updated_at: '2026-10-14T19:42:00Z',
    updated_by: 'jo@pyresauna.com',
  };

  it('names the version, the change time in studio time, and the editor', () => {
    expect(printFooter(sop, { 'jo@pyresauna.com': 'Jo Smith' })).toBe(
      'Version 7 · Last changed Oct 14, 2026, 3:42 PM by Jo Smith'
    );
  });

  it('reads the seed import as such', () => {
    expect(printFooter({ ...sop, updated_by: 'seed' })).toContain('by initial import');
  });

  it('leaves the editor off when none is recorded', () => {
    expect(printFooter({ ...sop, updated_by: null })).toBe(
      'Version 7 · Last changed Oct 14, 2026, 3:42 PM'
    );
  });
});
