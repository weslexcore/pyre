// Assignment-field validation, focused on duties — the one field that is a
// set rather than a scalar, and the only one the database's check constraint
// can't fully police (an array check can neither dedupe nor order).

import { describe, expect, it } from 'vitest';
import { parseAssignmentFields } from './validate';

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
});
