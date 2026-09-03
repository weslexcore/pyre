import { describe, expect, it } from 'vitest';
import { actorLabel, ownRunsFirst, personName, sameActor } from './names';

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

describe('sameActor', () => {
  it('matches the same email regardless of casing or padding', () => {
    expect(sameActor(' Wes@PyreSauna.com ', 'wes@pyresauna.com')).toBe(true);
  });

  it('never matches an empty or missing viewer', () => {
    expect(sameActor('', '')).toBe(false);
    expect(sameActor('wes@pyresauna.com', null)).toBe(false);
  });
});

describe('ownRunsFirst', () => {
  it('leads with the viewer’s runs and keeps each group’s order', () => {
    const runs = [
      { id: 'a', started_by: 'ada@pyresauna.com' },
      { id: 'b', started_by: 'Wes@pyresauna.com' },
      { id: 'c', started_by: 'bob@pyresauna.com' },
      { id: 'd', started_by: 'wes@pyresauna.com' },
    ];
    expect(ownRunsFirst(runs, 'wes@pyresauna.com').map((r) => r.id)).toEqual(['b', 'd', 'a', 'c']);
  });
});

describe('actorLabel', () => {
  const people = { 'wes@pyresauna.com': 'Wes McLaughlin', 'ada@pyresauna.com': 'Ada' };

  it('reads as "you" for the viewer', () => {
    expect(actorLabel('wes@pyresauna.com', 'Wes@pyresauna.com', people)).toBe('you');
  });

  it('reads as the roster name for anyone else', () => {
    expect(actorLabel('ada@pyresauna.com', 'wes@pyresauna.com', people)).toBe('Ada');
  });
});
