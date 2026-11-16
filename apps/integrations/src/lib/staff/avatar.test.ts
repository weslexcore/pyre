import { describe, expect, it } from 'vitest';
import { AVATAR_COLORS, avatarColorFor, avatarSrc, directoryEntryOf, initialOf } from './avatar';

describe('initialOf', () => {
  it('takes the first letter of the name, upper-cased', () => {
    expect(initialOf('maya lin')).toBe('M');
    expect(initialOf('  Élodie')).toBe('É');
    expect(initialOf('jo@x.com')).toBe('J');
  });
  it('skips leading punctuation and falls back to ?', () => {
    expect(initialOf('(Sam)')).toBe('S');
    expect(initialOf('')).toBe('?');
    expect(initialOf('   ')).toBe('?');
  });
});

describe('avatarColorFor', () => {
  it("uses the row's own pick when it is a known key", () => {
    expect(avatarColorFor('sage', 'a@x.com')).toBe(AVATAR_COLORS.sage);
  });
  it('falls back to a stable pick from the email', () => {
    const color = avatarColorFor(null, 'a@x.com');
    expect(Object.values(AVATAR_COLORS)).toContain(color);
    expect(avatarColorFor('not-a-key', 'a@x.com')).toBe(color);
  });
});

describe('avatarSrc', () => {
  it('is null without a photo, and versioned by the object key otherwise', () => {
    expect(avatarSrc({ id: 'abc', avatar_path: null })).toBeNull();
    expect(avatarSrc({ id: 'abc', avatar_path: 'abc/1234-5678.jpg' })).toBe(
      '/api/admin/staff-avatar?id=abc&v=1234-5678'
    );
  });
});

describe('directoryEntryOf', () => {
  const row = { id: 'abc', display_name: 'Maya Lin', avatar_path: null, avatar_color: 'gold' };
  it('keys people by lowercased email', () => {
    expect(directoryEntryOf({ ...row, email: ' Maya@Pyresauna.com ' })).toEqual({
      email: 'maya@pyresauna.com',
      name: 'Maya Lin',
      color: AVATAR_COLORS.gold,
      src: null,
    });
  });
  it('leaves out people with no email', () => {
    expect(directoryEntryOf({ ...row, email: null })).toBeNull();
  });
});
