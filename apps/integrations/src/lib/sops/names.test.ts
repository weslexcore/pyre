import { describe, expect, it } from 'vitest';
import { personName } from './names';

describe('personName', () => {
  const people = { 'wes@pyresauna.com': 'Wes McLaughlin' };

  it('uses the roster display name', () => {
    expect(personName('wes@pyresauna.com', people)).toBe('Wes McLaughlin');
  });

  it('matches regardless of the stored email casing or padding', () => {
    expect(personName(' Wes@PyreSauna.com ', people)).toBe('Wes McLaughlin');
  });

  it("falls back to the email's local part for someone off the roster", () => {
    expect(personName('someone@example.com', people)).toBe('someone');
  });

  it('falls back when no directory was loaded', () => {
    expect(personName('someone@example.com')).toBe('someone');
  });

  it('passes through a non-email actor unchanged', () => {
    expect(personName('seed', people)).toBe('seed');
  });
});
