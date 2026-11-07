import { describe, expect, it } from 'vitest';
import type { RosterRow } from '@/lib/notifications/recipients';
import { mentionPeople } from './mentions';

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
          person('admin', { is_admin: true, pages: ['/admin/boards'] }),
          // The admin flag alone opens no board.
          person('bare-admin', { is_admin: true }),
          person('all', { pages: ['/admin/boards'] }),
          person('member', { pages: ['board:rentals'] }),
          person('other', { pages: ['board:other'] }),
          person('unscheduled-admin', { is_admin: true, active: false, pages: ['/admin/boards'] }),
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
});
