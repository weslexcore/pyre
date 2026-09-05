import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Momence client is the boundary this module exists to tame, so it is the
// thing we fake. The cases below are the ones that decide whether a guest gets
// an email they shouldn't, or doesn't get one they should.
const fetchHostSessions = vi.fn();
const fetchSessionBookings = vi.fn();
const fetchHostMember = vi.fn();

vi.mock('@/lib/momence/host-api', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/momence/host-api')>('@/lib/momence/host-api');
  return {
    ...actual,
    fetchHostSessions: (...args: unknown[]) => fetchHostSessions(...args),
    fetchSessionBookings: (...args: unknown[]) => fetchSessionBookings(...args),
    fetchHostMember: (...args: unknown[]) => fetchHostMember(...args),
  };
});

const { attendeesForSession, sessionsInWindow } = await import('./attendees');

const session = {
  id: '10',
  name: 'Social Sauna',
  startsAt: '2026-09-01T22:00:00.000Z',
  endsAt: '2026-09-02T00:00:00.000Z',
};

beforeEach(() => {
  fetchHostSessions.mockReset();
  fetchSessionBookings.mockReset();
  fetchHostMember.mockReset();
});

describe('sessionsInWindow', () => {
  it('keeps a session that started before the window but was still running in it', async () => {
    fetchHostSessions.mockResolvedValue([
      {
        id: 1,
        name: 'Early',
        startsAt: '2026-09-01T20:00:00.000Z',
        endsAt: '2026-09-01T23:00:00.000Z',
      },
      {
        id: 2,
        name: 'Later',
        startsAt: '2026-09-02T04:00:00.000Z',
        endsAt: '2026-09-02T06:00:00.000Z',
      },
    ]);

    const found = await sessionsInWindow('2026-09-01T22:00:00.000Z', '2026-09-02T00:00:00.000Z');
    expect(found.map((s) => s.name)).toEqual(['Early']);
  });

  it('returns nothing for an unparseable window rather than asking Momence', async () => {
    expect(await sessionsInWindow('not-a-date', 'also-not')).toEqual([]);
    expect(fetchHostSessions).not.toHaveBeenCalled();
  });
});

describe('attendeesForSession', () => {
  it('reads the customer off a nested member object', async () => {
    fetchSessionBookings.mockResolvedValue([
      {
        id: 1,
        checkedIn: true,
        ticketsBought: 1,
        cancelledAt: null,
        member: { id: 42, email: 'Alex@Example.com', firstName: 'Alex', lastName: 'Rivera' },
      },
    ]);

    const result = await attendeesForSession(session);
    expect(result.attendees).toEqual([
      { memberId: '42', name: 'Alex Rivera', email: 'alex@example.com', checkedIn: true },
    ]);
    expect(result.identityAvailable).toBe(true);
  });

  it('reads the customer off flat fields too', async () => {
    fetchSessionBookings.mockResolvedValue([
      {
        id: 1,
        checkedIn: false,
        ticketsBought: 1,
        cancelledAt: null,
        memberId: 7,
        memberEmail: 'sam@example.com',
        firstName: 'Sam',
      },
    ]);

    const result = await attendeesForSession(session);
    expect(result.attendees[0]).toMatchObject({ memberId: '7', email: 'sam@example.com' });
  });

  it('never emails a cancelled booking', async () => {
    fetchSessionBookings.mockResolvedValue([
      {
        id: 1,
        checkedIn: false,
        ticketsBought: 1,
        cancelledAt: '2026-09-01T12:00:00.000Z',
        member: { id: 42, email: 'alex@example.com' },
      },
    ]);

    const result = await attendeesForSession(session);
    expect(result.attendees).toEqual([]);
    expect(result.bookingCount).toBe(0);
  });

  it('asks a person booked twice only once, and counts them as attending', async () => {
    fetchSessionBookings.mockResolvedValue([
      {
        id: 1,
        checkedIn: false,
        ticketsBought: 1,
        cancelledAt: null,
        member: { id: 42, email: 'alex@example.com', firstName: 'Alex' },
      },
      {
        id: 2,
        checkedIn: true,
        ticketsBought: 1,
        cancelledAt: null,
        member: { id: 42, email: 'alex@example.com', firstName: 'Alex' },
      },
    ]);

    const result = await attendeesForSession(session);
    expect(result.attendees).toHaveLength(1);
    expect(result.attendees[0].checkedIn).toBe(true);
  });

  it('fills a missing address from the member record, once per member', async () => {
    fetchSessionBookings.mockResolvedValue([
      { id: 1, checkedIn: true, ticketsBought: 1, cancelledAt: null, memberId: 42 },
      { id: 2, checkedIn: true, ticketsBought: 1, cancelledAt: null, memberId: 42 },
    ]);
    fetchHostMember.mockResolvedValue({
      email: 'alex@example.com',
      firstName: 'Alex',
      lastName: 'R',
    });

    const result = await attendeesForSession(session);
    expect(result.attendees).toHaveLength(1);
    expect(result.attendees[0].email).toBe('alex@example.com');
    expect(fetchHostMember).toHaveBeenCalledTimes(1);
  });

  it('drops anyone still unreachable after the lookup instead of guessing', async () => {
    fetchSessionBookings.mockResolvedValue([
      { id: 1, checkedIn: true, ticketsBought: 1, cancelledAt: null, memberId: 42 },
    ]);
    fetchHostMember.mockRejectedValue(new Error('502'));

    const result = await attendeesForSession(session);
    expect(result.attendees).toEqual([]);
  });

  it('flags a booking list that carries no identity at all', async () => {
    // The shape the code was written against before Lost & Found existed.
    fetchSessionBookings.mockResolvedValue([
      { id: 1, checkedIn: true, ticketsBought: 1, cancelledAt: null },
    ]);

    const result = await attendeesForSession(session);
    expect(result.attendees).toEqual([]);
    expect(result.bookingCount).toBe(1);
    expect(result.identityAvailable).toBe(false);
  });

  it('an empty session is not an outage', async () => {
    fetchSessionBookings.mockResolvedValue([]);
    const result = await attendeesForSession(session);
    expect(result.identityAvailable).toBe(true);
  });
});
