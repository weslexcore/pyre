import { describe, expect, it } from 'vitest';
import { normalizeEmail } from '@/lib/email/address';
import {
  canEditNote,
  canReply,
  canSeeNote,
  canSeeReply,
  canSetStatus,
  canTouchReply,
  isShiftNoteStatus,
  statusLabel,
  visibleNotesFilter,
} from './access';

const note = (author: string, admin_only = true) => ({ author_email: author, admin_only });

describe('canSeeNote', () => {
  const admin = { email: 'wes@pyresauna.com', isAdmin: true };
  const staff = { email: 'maya@pyresauna.com', isAdmin: false };

  it('gives an admin the whole log', () => {
    expect(canSeeNote(note('maya@pyresauna.com'), admin)).toBe(true);
    expect(canSeeNote(note('wes@pyresauna.com'), admin)).toBe(true);
    expect(canSeeNote(note('maya@pyresauna.com', false), admin)).toBe(true);
  });

  it('shows everyone a shared note', () => {
    expect(canSeeNote(note('sunny@pyresauna.com', false), staff)).toBe(true);
    expect(canSeeNote(note('sunny@pyresauna.com', false), { email: '', isAdmin: false })).toBe(
      true
    );
  });

  it('keeps an admin-only note to the admins and its author', () => {
    expect(canSeeNote(note('maya@pyresauna.com'), staff)).toBe(true);
    expect(canSeeNote(note('sunny@pyresauna.com'), staff)).toBe(false);
  });

  it('shows a session without an email no admin-only note', () => {
    expect(canSeeNote(note('maya@pyresauna.com'), { email: '', isAdmin: false })).toBe(false);
    // An author_email is never blank (the column checks length), so an empty
    // session email must not match one by accident.
    expect(canSeeNote(note(''), { email: '', isAdmin: false })).toBe(false);
  });
});

describe('canEditNote', () => {
  it('is the author and the admins, shared or not', () => {
    const maya = { email: 'maya@pyresauna.com', isAdmin: false };
    expect(canEditNote(note('maya@pyresauna.com', false), maya)).toBe(true);
    expect(canEditNote(note('sunny@pyresauna.com', false), maya)).toBe(false);
    expect(canEditNote(note('sunny@pyresauna.com'), { email: 'wes@x.com', isAdmin: true })).toBe(
      true
    );
    expect(canEditNote(note(''), { email: '', isAdmin: false })).toBe(false);
  });
});

describe('visibleNotesFilter', () => {
  it("matches shared notes and the viewer's own", () => {
    expect(visibleNotesFilter('maya@pyresauna.com')).toBe(
      'admin_only.eq.false,author_email.eq."maya@pyresauna.com"'
    );
  });

  it('falls back to shared notes alone when the email cannot be quoted', () => {
    expect(visibleNotesFilter('')).toBe('admin_only.eq.false');
    expect(visibleNotesFilter('a"b@x.com')).toBe('admin_only.eq.false');
    expect(visibleNotesFilter('a,b@x.com')).toBe('admin_only.eq.false');
  });
});

describe('normalizeEmail', () => {
  it('matches how author_email is stored', () => {
    expect(normalizeEmail('  Maya@PyreSauna.com ')).toBe('maya@pyresauna.com');
  });

  it('reads a missing session email as none', () => {
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail(undefined)).toBe('');
    expect(normalizeEmail('   ')).toBe('');
  });
});

describe('status', () => {
  it('recognises exactly the three statuses', () => {
    expect(isShiftNoteStatus('open')).toBe(true);
    expect(isShiftNoteStatus('todo')).toBe(true);
    expect(isShiftNoteStatus('resolved')).toBe(true);
    expect(isShiftNoteStatus('closed')).toBe(false);
    expect(isShiftNoteStatus(undefined)).toBe(false);
    expect(statusLabel('todo')).toBe('To do');
  });

  it('is set by admins only', () => {
    expect(canSetStatus({ email: 'wes@pyresauna.com', isAdmin: true })).toBe(true);
    expect(canSetStatus({ email: 'maya@pyresauna.com', isAdmin: false })).toBe(false);
  });
});

describe('replies', () => {
  const admin = { email: 'wes@pyresauna.com', isAdmin: true };
  const maya = { email: 'maya@pyresauna.com', isAdmin: false };
  const reply = (author: string, is_private = false) => ({ author_email: author, is_private });

  it('lets the author and admins reply, nobody else', () => {
    expect(canReply(note('maya@pyresauna.com'), maya)).toBe(true);
    expect(canReply(note('sunny@pyresauna.com'), maya)).toBe(false);
    expect(canReply(note('sunny@pyresauna.com'), admin)).toBe(true);
    // Seeing a shared note doesn't make you part of its conversation.
    expect(canReply(note('sunny@pyresauna.com', false), maya)).toBe(false);
  });

  it('hides private replies from everyone but admins', () => {
    expect(canSeeReply(reply('wes@pyresauna.com'), maya)).toBe(true);
    expect(canSeeReply(reply('wes@pyresauna.com', true), maya)).toBe(false);
    expect(canSeeReply(reply('wes@pyresauna.com', true), admin)).toBe(true);
  });

  it('lets a reply be edited by its author or an admin', () => {
    expect(canTouchReply(reply('maya@pyresauna.com'), maya)).toBe(true);
    expect(canTouchReply(reply('wes@pyresauna.com'), maya)).toBe(false);
    expect(canTouchReply(reply('maya@pyresauna.com'), admin)).toBe(true);
    expect(canTouchReply(reply('maya@pyresauna.com'), { email: '', isAdmin: false })).toBe(false);
  });

  it('never lets anyone edit or delete an event', () => {
    const event = { ...reply('wes@pyresauna.com'), kind: 'status' as const };
    expect(canTouchReply(event, admin)).toBe(false);
    expect(
      canTouchReply({ author_email: null, is_private: true, kind: 'classification' }, admin)
    ).toBe(false);
    expect(canTouchReply({ ...reply('wes@pyresauna.com'), kind: 'comment' }, admin)).toBe(true);
  });
});
