import { describe, expect, it } from 'vitest';
import { canSeeNote, normalizeEmail } from './access';

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
