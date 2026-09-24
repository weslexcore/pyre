import { describe, expect, it } from 'vitest';
import { type PickerSession, searchSessions } from './LostFoundSessionChoices';

function session(id: string, name: string, startsAt: string, guests: string[]): PickerSession {
  return {
    id,
    name,
    startsAt,
    endsAt: startsAt,
    bookingCount: guests.length,
    identityAvailable: true,
    attendees: guests.map((g) => ({ name: g, maskedEmail: `${g}@x`, checkedIn: true })),
  };
}

// Friday Sep 18 and Saturday Sep 19, 2026, evenings in New York.
const SESSIONS = [
  session('a', 'Social Sauna', '2026-09-18T23:30:00.000Z', ['Dana Reyes', 'Sam Oh']),
  session('b', 'Guided Breathwork', '2026-09-19T23:30:00.000Z', ['Priya Nair']),
];

const ids = (results: ReturnType<typeof searchSessions>) => results.map((r) => r.session.id);

describe('searchSessions', () => {
  it('shows everything for an empty query', () => {
    expect(ids(searchSessions(SESSIONS, '  ', new Set()))).toEqual(['a', 'b']);
  });

  it('matches the class name and the displayed day', () => {
    expect(ids(searchSessions(SESSIONS, 'guided', new Set()))).toEqual(['b']);
    expect(ids(searchSessions(SESSIONS, 'fri', new Set()))).toEqual(['a']);
    expect(ids(searchSessions(SESSIONS, 'sep 19', new Set()))).toEqual(['b']);
  });

  it('finds a session by a guest in it and says who matched', () => {
    const results = searchSessions(SESSIONS, 'dana', new Set());
    expect(ids(results)).toEqual(['a']);
    expect(results[0].matchedNames).toEqual(['Dana Reyes']);
  });

  it('never hides a picked session', () => {
    expect(ids(searchSessions(SESSIONS, 'priya', new Set(['a'])))).toEqual(['a', 'b']);
  });
});
