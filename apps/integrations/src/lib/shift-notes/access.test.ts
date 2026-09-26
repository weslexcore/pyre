import { describe, expect, it } from 'vitest';
import {
  canReply,
  canSeeNote,
  canSeeReply,
  canSetStatus,
  canTouchReply,
  isShiftNoteStatus,
  normalizeEmail,
  statusLabel,
} from './access';

const note = (author: string) => ({ author_email: author });

describe('canSeeNote', () => {
  it('gives an admin the whole log', () => {
    const admin = { email: 'wes@pyresauna.com', isAdmin: true };
    expect(canSeeNote(note('maya@pyresauna.com'), admin)).toBe(true);
    expect(canSeeNote(note('wes@pyresauna.com'), admin)).toBe(true);
  });

  it('gives everyone else only what they wrote', () => {
    const staff = { email: 'maya@pyresauna.com', isAdmin: false };
    expect(canSeeNote(note('maya@pyresauna.com'), staff)).toBe(true);
    expect(canSeeNote(note('sunny@pyresauna.com'), staff)).toBe(false);
  });

  it('shows a session without an email nothing', () => {
    expect(canSeeNote(note('maya@pyresauna.com'), { email: '', isAdmin: false })).toBe(false);
    // An author_email is never blank (the column checks length), so an empty
    // session email must not match one by accident.
    expect(canSeeNote(note(''), { email: '', isAdmin: false })).toBe(false);
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
