import { describe, expect, it } from 'vitest';
import {
  addedAudience,
  canReplyToMessage,
  canTouchReply,
  canViewMessage,
  resolveAudience,
} from './access';

const message = {
  author_email: 'wes@pyre.test',
  audience_roles: ['shift_lead', 'admin'] as ('staff' | 'shift_lead' | 'admin')[],
  audience_emails: ['named@pyre.test'],
  archived_at: null as string | null,
};

const admin = { role: 'admin' as const, email: 'admin@pyre.test' };
const lead = { role: 'shift_lead' as const, email: 'lead@pyre.test' };
const staff = { role: 'staff' as const, email: 'staff@pyre.test' };
const named = { role: 'staff' as const, email: 'named@pyre.test' };

describe('canViewMessage', () => {
  it('admins and the author always see it', () => {
    expect(canViewMessage(admin, message)).toBe(true);
    expect(canViewMessage({ role: 'staff', email: 'wes@pyre.test' }, message)).toBe(true);
  });

  it('a granted role or a named email sees it; others do not', () => {
    expect(canViewMessage(lead, message)).toBe(true);
    expect(canViewMessage(named, message)).toBe(true);
    expect(canViewMessage(staff, message)).toBe(false);
  });

  it('archiving hides it from everyone but admins and the author', () => {
    const archived = { ...message, archived_at: '2026-09-14T00:00:00Z' };
    expect(canViewMessage(lead, archived)).toBe(false);
    expect(canViewMessage(named, archived)).toBe(false);
    expect(canViewMessage(admin, archived)).toBe(true);
  });
});

describe('canReplyToMessage / canTouchReply', () => {
  it('replies stop once archived', () => {
    expect(canReplyToMessage(lead, message)).toBe(true);
    expect(canReplyToMessage(lead, { ...message, archived_at: 'x' })).toBe(false);
  });

  it('a reply is its author’s or an admin’s to change', () => {
    const reply = { author_email: 'lead@pyre.test' };
    expect(canTouchReply(reply, lead)).toBe(true);
    expect(canTouchReply(reply, admin)).toBe(true);
    expect(canTouchReply(reply, named)).toBe(false);
    expect(canTouchReply(reply, { role: 'staff', email: '' })).toBe(false);
  });
});

const rows = [
  { email: 'Admin@pyre.test', active: true, is_admin: true, is_shift_lead: false, pages: [] },
  { email: 'lead@pyre.test', active: true, is_admin: false, is_shift_lead: true, pages: [] },
  { email: 'staff@pyre.test', active: true, is_admin: false, is_shift_lead: false, pages: [] },
  { email: 'named@pyre.test', active: true, is_admin: false, is_shift_lead: false, pages: [] },
  // Left: off the schedule, no grants, no dashboard.
  { email: 'left@pyre.test', active: false, is_admin: false, is_shift_lead: true, pages: [] },
  // Off the schedule but granted a page: still signs in and reads messages.
  {
    email: 'marketing@pyre.test',
    active: false,
    is_admin: false,
    is_shift_lead: false,
    pages: ['/admin/campaigns'],
  },
  // An admin who never works a shift.
  { email: 'owner@pyre.test', active: false, is_admin: true, is_shift_lead: false, pages: [] },
  { email: null, active: true, is_admin: false, is_shift_lead: true, pages: [] },
];

describe('resolveAudience', () => {
  it('unions roles and named people over dashboard users with an email', () => {
    expect(resolveAudience(rows, message)).toEqual([
      'admin@pyre.test',
      'lead@pyre.test',
      'named@pyre.test',
      'owner@pyre.test',
    ]);
  });

  it('reaches people off the schedule who still use the dashboard, not people who left', () => {
    const everyone = {
      ...message,
      audience_roles: ['staff' as const, 'shift_lead' as const, 'admin' as const],
    };
    const reached = resolveAudience(rows, everyone);
    expect(reached).toContain('marketing@pyre.test');
    expect(reached).toContain('owner@pyre.test');
    expect(reached).not.toContain('left@pyre.test');
  });

  it('dedupes someone both named and role-granted', () => {
    expect(resolveAudience(rows, { ...message, audience_emails: ['lead@pyre.test'] })).toEqual([
      'admin@pyre.test',
      'lead@pyre.test',
      'owner@pyre.test',
    ]);
  });
});

describe('addedAudience', () => {
  it('lists only the people a widened audience newly reaches', () => {
    const wider = { ...message, audience_roles: [...message.audience_roles, 'staff' as const] };
    expect(addedAudience(rows, message, wider)).toEqual(['staff@pyre.test', 'marketing@pyre.test']);
  });

  it('counts a newly named person, and nobody when the audience narrows', () => {
    const plusOne = {
      ...message,
      audience_emails: [...message.audience_emails, 'staff@pyre.test'],
    };
    expect(addedAudience(rows, message, plusOne)).toEqual(['staff@pyre.test']);
    const narrower = { ...message, audience_roles: ['admin' as const], audience_emails: [] };
    expect(addedAudience(rows, message, narrower)).toEqual([]);
  });
});
