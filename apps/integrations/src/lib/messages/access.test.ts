import { describe, expect, it } from 'vitest';
import {
  addedAudience,
  addedCollaborators,
  canChangeMessage,
  canReplyToMessage,
  canTouchReply,
  canViewMessage,
  resolveAudience,
  roleIsNotified,
} from './access';

const message = {
  author_email: 'wes@pyre.test',
  audience_roles: ['shift_lead', 'admin'] as ('staff' | 'shift_lead' | 'admin')[],
  audience_emails: ['named@pyre.test'],
  archived_at: null as string | null,
  sent_at: '2026-09-14T00:00:00Z' as string | null,
  shared_with: [] as string[],
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
  {
    email: 'lead@pyre.test',
    active: true,
    is_admin: false,
    is_shift_lead: true,
    pages: ['/admin/shift-notes'],
  },
  {
    email: 'staff@pyre.test',
    active: true,
    is_admin: false,
    is_shift_lead: false,
    pages: ['/admin/shift-notes'],
  },
  {
    email: 'named@pyre.test',
    active: true,
    is_admin: false,
    is_shift_lead: false,
    pages: ['/admin/shift-notes'],
  },
  // On the schedule with no page ticked: no dashboard, so no messages.
  { email: 'unticked@pyre.test', active: true, is_admin: false, is_shift_lead: true, pages: [] },
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

describe('roleIsNotified', () => {
  it('pings a role only when it is ticked, admins included', () => {
    const toOne = { audience_roles: [] as 'admin'[], audience_emails: ['named@pyre.test'] };
    expect(roleIsNotified(toOne, 'admin')).toBe(false);
    expect(resolveAudience(rows, toOne)).toEqual(['named@pyre.test']);

    expect(roleIsNotified(message, 'admin')).toBe(true);
    expect(roleIsNotified(message, 'staff')).toBe(false);
  });

  it('still lets admins open a message their role was left off', () => {
    const toOne = { ...message, audience_roles: [] as 'admin'[] };
    expect(canViewMessage(admin, toOne)).toBe(true);
    expect(canViewMessage(lead, toOne)).toBe(false);
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

describe('drafts', () => {
  const author = { role: 'admin' as const, email: 'wes@pyre.test' };
  const draft = { ...message, sent_at: null };
  const shared = { ...draft, shared_with: ['admin@pyre.test', 'lead@pyre.test'] };

  it('a private draft is its author’s alone, other admins and the audience included', () => {
    expect(canViewMessage(author, draft)).toBe(true);
    expect(canViewMessage(admin, draft)).toBe(false);
    expect(canViewMessage(lead, draft)).toBe(false);
    expect(canViewMessage(named, draft)).toBe(false);
  });

  it('a shared draft opens to the admins it names, never to non-admins', () => {
    expect(canViewMessage(admin, shared)).toBe(true);
    expect(canChangeMessage(admin, shared)).toBe(true);
    expect(canViewMessage(lead, shared)).toBe(false);
    expect(canChangeMessage({ role: 'admin', email: 'other@pyre.test' }, shared)).toBe(false);
  });

  it('a draft has no thread; once sent, any admin may change it', () => {
    expect(canReplyToMessage(author, shared)).toBe(false);
    expect(canChangeMessage({ role: 'admin', email: 'other@pyre.test' }, message)).toBe(true);
    expect(canChangeMessage(lead, message)).toBe(false);
  });

  it('sharing pings only the admins it adds, never the editor', () => {
    expect(addedCollaborators(['a@x'], ['a@x', 'b@x', 'me@x'], 'me@x')).toEqual(['b@x']);
    expect(addedCollaborators(['a@x', 'b@x'], ['a@x'], 'me@x')).toEqual([]);
  });
});
