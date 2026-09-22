import { describe, expect, it } from 'vitest';
import type { RosterRow } from '@/lib/notifications/recipients';
import { mentionedEmails, mentionPeople, mentionQuery } from './mentions';

const person = (id: string, overrides: Partial<RosterRow> = {}): RosterRow => ({
  id,
  email: `${id}@pyre.test`,
  display_name: id,
  active: true,
  is_admin: false,
  is_shift_lead: false,
  pages: [],
  ...overrides,
});

describe('board mentions', () => {
  it('offers people with subject access regardless of scheduling availability', () => {
    expect(
      mentionPeople(
        [
          person('admin', { is_admin: true }),
          person('all', { pages: ['/admin/boards'] }),
          person('member', { pages: ['board:rentals'] }),
          person('other', { pages: ['board:other'] }),
          person('unscheduled-admin', { is_admin: true, active: false }),
          person('unscheduled-all', { pages: ['/admin/boards'], active: false }),
          person('unscheduled-legacy', { pages: ['/admin/goals'], active: false }),
          person('unscheduled-member', { pages: ['board:rentals'], active: false }),
          person('revoked', { active: false }),
          person('empty', { is_admin: true, email: null }),
        ],
        ['rentals']
      ).map((p) => p.email)
    ).toEqual([
      'admin@pyre.test',
      'all@pyre.test',
      'member@pyre.test',
      'unscheduled-admin@pyre.test',
      'unscheduled-all@pyre.test',
      'unscheduled-legacy@pyre.test',
      'unscheduled-member@pyre.test',
    ]);
  });

  it('recognizes explicit mentions with punctuation, normalizes and deduplicates them', () => {
    const people = [
      { name: 'A', email: 'a@pyre.test' },
      { name: 'B', email: 'b@pyre.test' },
    ];
    expect(mentionedEmails('Hi @A@pyre.test, (@b@pyre.test)! @a@pyre.test.', people)).toEqual([
      'a@pyre.test',
      'b@pyre.test',
    ]);
    expect(
      mentionedEmails('a@pyre.test x@a@pyre.test @unknown@pyre.test @a@pyre.test.evil', people)
    ).toEqual([]);
  });

  it('finds a query at the caret without treating normal email as a trigger', () => {
    expect(mentionQuery('Hi @May after', 7)).toEqual({ start: 3, query: 'may' });
    expect(mentionQuery('Hi @', 4)).toEqual({ start: 3, query: '' });
    expect(mentionQuery('a@pyre.test', 11)).toBeNull();
  });
});
