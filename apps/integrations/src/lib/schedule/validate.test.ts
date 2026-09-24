// Assignment-field validation, focused on duties — the one field that is a
// set rather than a scalar, and the only one checked against an admin-edited
// list (shift_duties) rather than a database constraint.

import { DEFAULT_DUTY_CATALOG } from '@pyre/schedule-core';
import { describe, expect, it } from 'vitest';
import { parseAssignmentFields as parse } from './validate';

const parseAssignmentFields = (body: Record<string, unknown>, held?: string[]) =>
  parse(body, DEFAULT_DUTY_CATALOG, held);

describe('parseAssignmentFields duties', () => {
  it('normalises the set into canonical phase order', () => {
    expect(parseAssignmentFields({ duties: ['breakdown_a', 'setup_a', 'setup_a'] })).toEqual({
      duties: ['setup_a', 'breakdown_a'],
    });
  });

  it('treats an empty array as "clear the duties"', () => {
    expect(parseAssignmentFields({ duties: [] })).toEqual({ duties: [] });
  });

  it('leaves duties alone when the caller does not mention them', () => {
    expect(parseAssignmentFields({ role: 'setup' })).toEqual({ role: 'setup' });
  });

  it('rejects unknown duties instead of silently dropping them', () => {
    expect(parseAssignmentFields({ duties: ['host', 'sweeping'] })).toContain(
      'duties must each be'
    );
    expect(parseAssignmentFields({ duties: 'host' })).toBe('duties must be an array');
    expect(parseAssignmentFields({ duties: [3] })).toContain('duties must each be');
  });

  it('accepts an archived duty only on an assignment that already held it', () => {
    const catalog = DEFAULT_DUTY_CATALOG.map((d) =>
      d.key === 'host' ? { ...d, archived: true } : d
    );
    expect(parse({ duties: ['host'] }, catalog)).toContain('duties must each be');
    expect(parse({ duties: ['host'] }, catalog)).not.toContain('host,');
    expect(parse({ duties: ['host', 'setup_a'] }, catalog, ['host'])).toEqual({
      duties: ['setup_a', 'host'],
    });
  });

  it('accepts several duties from the same phase on one person', () => {
    const catalog = [
      ...DEFAULT_DUTY_CATALOG,
      {
        key: 'plunge_care',
        label: 'Plunge Care',
        detail: null,
        phase: 'setup' as const,
        side: null,
        sessionDefault: null,
        sopSlug: null,
        sortOrder: 1.5,
        archived: false,
      },
    ];
    expect(parse({ duties: ['plunge_care', 'setup_b', 'setup_a'] }, catalog)).toEqual({
      duties: ['setup_a', 'setup_b', 'plunge_care'],
    });
  });
});
