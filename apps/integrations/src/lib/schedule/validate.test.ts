// Assignment-field validation, focused on duties — the one field that is a
// set rather than a scalar, and the only one checked against an admin-edited
// list (shift_duties) rather than a database constraint.

import { DEFAULT_DUTY_CATALOG, type DutyDef, trainingFromRows } from '@pyre/schedule-core';
import { describe, expect, it } from 'vitest';
import { parseAssignmentFields as parse, trainingError } from './validate';

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
    expect(parseAssignmentFields({ startsAt: '09:00' })).toEqual({ starts_at: '09:00' });
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
        days: null,
        sortOrder: 1.5,
        requiresTraining: false,
        archived: false,
      },
    ];
    expect(parse({ duties: ['plunge_care', 'setup_b', 'setup_a'] }, catalog)).toEqual({
      duties: ['setup_a', 'setup_b', 'plunge_care'],
    });
  });
});

describe('off-shift duties and training', () => {
  const carboys: DutyDef = {
    key: 'fill_carboys',
    label: 'Fill Carboys',
    detail: null,
    phase: 'off_shift',
    side: null,
    sessionDefault: null,
    sopSlug: null,
    days: [1],
    sortOrder: 10,
    requiresTraining: false,
    archived: false,
  };

  it('never puts an off-shift duty on a shift', () => {
    expect(parse({ duties: ['fill_carboys'] }, [...DEFAULT_DUTY_CATALOG, carboys])).toMatch(
      /duties must each be one of/
    );
  });

  it('names the duties someone is not trained on, sparing ones they hold', () => {
    const catalog = DEFAULT_DUTY_CATALOG.map((d) =>
      d.key === 'host' ? { ...d, requiresTraining: true } : d
    );
    const training = trainingFromRows([{ staff_id: 'sunny', duty_key: 'host' }]);
    expect(trainingError(catalog, training, 'sunny', 'Sunny', ['host'])).toBeNull();
    expect(trainingError(catalog, training, 'julien', 'Julien', ['setup_b', 'host'])).toMatch(
      /^Julien isn't trained on Host\./
    );
    expect(trainingError(catalog, training, 'julien', 'Julien', ['host'], ['host'])).toBeNull();
  });
});
