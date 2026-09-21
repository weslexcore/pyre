import { describe, expect, it } from 'vitest';
import { canReplyToMessage, canTouchReply, canViewMessage, resolveAudience } from './access';

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

describe('resolveAudience', () => {
  const rows = [
    { email: 'Admin@pyre.test', active: true, is_admin: true, is_shift_lead: false },
    { email: 'lead@pyre.test', active: true, is_admin: false, is_shift_lead: true },
    { email: 'staff@pyre.test', active: true, is_admin: false, is_shift_lead: false },
    { email: 'named@pyre.test', active: true, is_admin: false, is_shift_lead: false },
    { email: 'left@pyre.test', active: false, is_admin: false, is_shift_lead: true },
    { email: null, active: true, is_admin: false, is_shift_lead: true },
  ];

  it('unions roles and named people over active rows with an email', () => {
    expect(resolveAudience(rows, message)).toEqual([
      'admin@pyre.test',
      'lead@pyre.test',
      'named@pyre.test',
    ]);
  });

  it('dedupes someone both named and role-granted', () => {
    expect(resolveAudience(rows, { ...message, audience_emails: ['lead@pyre.test'] })).toEqual([
      'admin@pyre.test',
      'lead@pyre.test',
    ]);
  });
});
