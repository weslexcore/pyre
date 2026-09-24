import { describe, expect, it } from 'vitest';
import {
  adminEmails,
  boardRecipients,
  canOpenSchedule,
  dashboardRecipients,
  nameFor,
  type RosterRow,
  sopUpdateRecipients,
} from './recipients';

function person(overrides: Partial<RosterRow> & { id: string }): RosterRow {
  return {
    email: `${overrides.id}@pyre.test`,
    display_name: overrides.id,
    active: true,
    is_admin: false,
    is_shift_lead: false,
    pages: [],
    ...overrides,
  };
}

const roster: RosterRow[] = [
  person({ id: 'admin', is_admin: true }),
  person({ id: 'lead', is_shift_lead: true, pages: ['/admin/sops', '/admin/schedule'] }),
  person({ id: 'staff', pages: ['/admin/sops'] }),
  person({ id: 'nosops', pages: ['/admin/schedule'] }),
  // Left: off the schedule with no admin flag or grants, so no dashboard.
  person({ id: 'gone', active: false, pages: [] }),
  person({ id: 'noemail', email: null }),
];

describe('dashboardRecipients / adminEmails', () => {
  it('keeps dashboard users with an email', () => {
    expect(dashboardRecipients(roster).map((r) => r.id)).toEqual([
      'admin',
      'lead',
      'staff',
      'nosops',
    ]);
    expect(adminEmails(roster)).toEqual(['admin@pyre.test']);
  });

  it('keeps people off the schedule who still use the dashboard', () => {
    const offSchedule = [
      person({ id: 'owner', active: false, is_admin: true }),
      person({ id: 'marketing', active: false, pages: ['/admin/campaigns'] }),
    ];
    expect(dashboardRecipients(offSchedule).map((r) => r.id)).toEqual(['owner', 'marketing']);
    expect(adminEmails(offSchedule)).toEqual(['owner@pyre.test']);
  });
});

describe('sopUpdateRecipients', () => {
  const sop = {
    view_roles: ['shift_lead' as const],
    edit_roles: ['admin' as const],
    view_emails: ['staff@pyre.test'],
    edit_emails: [],
    archived: false,
  };

  it('needs the SOP page and a view grant; admins always qualify', () => {
    expect(sopUpdateRecipients(roster, sop)).toEqual([
      'admin@pyre.test',
      'lead@pyre.test',
      'staff@pyre.test',
    ]);
  });

  it('drops people who hold the page but not the document', () => {
    expect(sopUpdateRecipients(roster, { ...sop, view_emails: [] })).toEqual([
      'admin@pyre.test',
      'lead@pyre.test',
    ]);
  });
});

describe('canOpenSchedule / nameFor', () => {
  it('reads the schedule grant, or admin', () => {
    expect(canOpenSchedule(roster[0])).toBe(true);
    expect(canOpenSchedule(roster[2])).toBe(false);
    expect(canOpenSchedule(roster[3])).toBe(true);
  });

  it('falls back from roster name to the email local part', () => {
    expect(nameFor(roster, 'LEAD@pyre.test')).toBe('lead');
    expect(nameFor(roster, 'stranger@elsewhere.test')).toBe('stranger');
    expect(nameFor(roster, null)).toBe('Someone');
  });
});

describe('boardRecipients', () => {
  const boardRoster: RosterRow[] = [
    person({ id: 'boss', is_admin: true }),
    person({ id: 'cofounder', pages: ['/admin/boards'] }),
    person({ id: 'community', pages: ['board:rentals'] }),
    person({ id: 'attendant', pages: ['/admin/shift-notes'] }),
    // Left: off the schedule and their grants taken away.
    person({ id: 'former', pages: [], active: false }),
    // Off the schedule but still holding the page — still works the boards.
    person({ id: 'advisor', pages: ['/admin/boards'], active: false }),
  ];

  it('reaches admins, the page grant, and that board\u2019s own grant', () => {
    expect(boardRecipients(boardRoster, 'rentals').sort()).toEqual([
      'advisor@pyre.test',
      'boss@pyre.test',
      'cofounder@pyre.test',
      'community@pyre.test',
    ]);
  });

  it('does not wake a single-board grantee about another board', () => {
    // The whole point of board:rentals: the founders' task board stays out
    // of this person's inbox as well as out of their nav.
    expect(boardRecipients(boardRoster, 'goals').sort()).toEqual([
      'advisor@pyre.test',
      'boss@pyre.test',
      'cofounder@pyre.test',
    ]);
  });

  it('skips people with no board access and people off the roster', () => {
    const reached = boardRecipients(boardRoster, 'rentals');
    expect(reached).not.toContain('attendant@pyre.test');
    expect(reached).not.toContain('former@pyre.test');
  });
});
