import { describe, expect, it } from 'vitest';
import type { GuestFloorCheckinRow } from '@/lib/db';
import type { HostSession, SessionBooking } from '@/lib/momence/host-api';
import { estimateCheckIn, floorGuests, floorSessions } from './floor';
import { compareFloor, floorTiming, onFloor } from './floor-timing';

const NOW = Date.parse('2026-10-27T22:30:00.000Z');
const min = (n: number) => n * 60_000;
const at = (offsetMinutes: number) => new Date(NOW + min(offsetMinutes)).toISOString();

function session(id: number, startOffset: number, length = 60): HostSession {
  return {
    id,
    name: 'Open Hours',
    startsAt: at(startOffset),
    endsAt: at(startOffset + length),
    isDraft: false,
  };
}

function booking(overrides: Partial<SessionBooking> = {}): SessionBooking {
  return {
    id: 1,
    checkedIn: false,
    ticketsBought: 1,
    cancelledAt: null,
    createdAt: at(-600),
    member: { id: 7, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    ...overrides,
  };
}

function row(overrides: Partial<GuestFloorCheckinRow> = {}): GuestFloorCheckinRow {
  return {
    booking_id: '1',
    session_id: '10',
    member_id: '7',
    checked_in_at: at(-20),
    session_minutes: null,
    warned_at: null,
    warned_by: null,
    updated_by: 'staff@pyresauna.com',
    created_at: at(-20),
    updated_at: at(-20),
    ...overrides,
  };
}

describe('floorSessions', () => {
  it('keeps sessions started in the last four hours or starting within the hour', () => {
    const kept = floorSessions(
      [session(1, -300), session(2, -200), session(3, 30), session(4, 90)],
      NOW
    );
    expect(kept.map((s) => s.id)).toEqual(['2', '3']);
    expect(kept[0].minutes).toBe(60);
  });
});

describe('estimateCheckIn', () => {
  it('uses the session start for a guest booked ahead', () => {
    expect(estimateCheckIn(at(-30), at(-600))).toBe(at(-30));
  });

  it('uses the booking time for a walk-in booked after the start', () => {
    expect(estimateCheckIn(at(-30), at(-10))).toBe(at(-10));
  });

  it('falls back to the session start without a booking time', () => {
    expect(estimateCheckIn(at(-30), undefined)).toBe(at(-30));
  });
});

describe('floorGuests', () => {
  const [s] = floorSessions([{ ...session(10, -30), id: 10 }], NOW);

  it('lists a booked guest as waiting until checked in', () => {
    const [guest] = floorGuests(s, [booking()], new Map());
    expect(guest).toMatchObject({
      bookingId: '1',
      name: 'Ada Lovelace',
      checkedIn: false,
      checkedInAt: null,
      minutes: 60,
    });
  });

  it('prefers the recorded time and length', () => {
    const [guest] = floorGuests(
      s,
      [booking({ checkedIn: true })],
      new Map([['1', row({ session_minutes: 90 })]])
    );
    expect(guest).toMatchObject({
      checkedInAt: at(-20),
      estimated: false,
      minutes: 90,
      customMinutes: true,
    });
  });

  it('estimates a guest checked in elsewhere', () => {
    const [guest] = floorGuests(s, [booking({ checkedIn: true })], new Map());
    expect(guest).toMatchObject({ checkedInAt: at(-30), estimated: true });
  });

  it('drops cancelled bookings', () => {
    expect(floorGuests(s, [booking({ cancelledAt: at(-60) })], new Map())).toEqual([]);
  });
});

describe('floorTiming', () => {
  it('is in progress with more than 15 minutes left', () => {
    const t = floorTiming({ checkedInAt: at(-30), minutes: 60 }, NOW);
    expect(t.status).toBe('in');
    expect(t.progress).toBeCloseTo(0.5);
    expect(t.remainingMs).toBe(min(30));
  });

  it('calls for the warning at 15 minutes left', () => {
    expect(floorTiming({ checkedInAt: at(-45), minutes: 60 }, NOW).status).toBe('warn');
    expect(floorTiming({ checkedInAt: at(-44), minutes: 60 }, NOW).status).toBe('in');
  });

  it('is over once their time is up, capped at a full bar', () => {
    const t = floorTiming({ checkedInAt: at(-70), minutes: 60 }, NOW);
    expect(t.status).toBe('over');
    expect(t.progress).toBe(1);
    expect(t.remainingMs).toBe(-min(10));
  });

  it('is waiting without a check-in', () => {
    expect(floorTiming({ checkedInAt: null, minutes: 60 }, NOW).status).toBe('waiting');
  });

  it('keeps an overtime guest listed for half an hour', () => {
    expect(onFloor(floorTiming({ checkedInAt: at(-80), minutes: 60 }, NOW))).toBe(true);
    expect(onFloor(floorTiming({ checkedInAt: at(-91), minutes: 60 }, NOW))).toBe(false);
  });

  it('sorts warnings first, then overtime, then by time left', () => {
    const timings = [
      floorTiming({ checkedInAt: at(-10), minutes: 60 }, NOW),
      floorTiming({ checkedInAt: at(-65), minutes: 60 }, NOW),
      floorTiming({ checkedInAt: at(-50), minutes: 60 }, NOW),
      floorTiming({ checkedInAt: at(-30), minutes: 60 }, NOW),
    ];
    const order = [...timings].sort(compareFloor).map((t) => t.status);
    expect(order).toEqual(['warn', 'over', 'in', 'in']);
    expect([...timings].sort(compareFloor)[2].remainingMs).toBe(min(30));
  });
});
