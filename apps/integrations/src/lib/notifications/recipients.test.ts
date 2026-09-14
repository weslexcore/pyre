import { describe, expect, it } from 'vitest';
import {
  adminEmails,
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
  person({ id: 'gone', active: false, is_admin: true }),
  person({ id: 'noemail', email: null }),
];

describe('dashboardRecipients / adminEmails', () => {
  it('keeps active rows with an email', () => {
    expect(dashboardRecipients(roster).map((r) => r.id)).toEqual([
      'admin',
      'lead',
      'staff',
      'nosops',
    ]);
    expect(adminEmails(roster)).toEqual(['admin@pyre.test']);
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
