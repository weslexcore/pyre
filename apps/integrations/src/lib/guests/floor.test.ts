import { describe, expect, it } from 'vitest';
import type { GuestFloorCheckinRow } from '@/lib/db';
import type { HostSession, SessionBooking } from '@/lib/momence/host-api';
import {
  estimateCheckIn,
  type FloorSeat,
  findMoves,
  floorGuests,
  floorSessions,
  MOMENCE_ACTOR,
  MOVE_ACTOR,
  movedRow,
} from './floor';
import {
  type Checkpoint,
  compareFloor,
  DEFAULT_CHECKPOINTS,
  floorTiming,
  onFloor,
  parseCheckpoints,
  parseSessionLengths,
} from './floor-timing';

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
    checkpoints_done: {},
    moved_from_booking_id: null,
    moved_from_session_id: null,
    checked_out_at: null,
    checked_out_by: null,
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

  it('uses the time Momence sent while Momence has them checked in', () => {
    const rows = new Map([['1', row({ checked_in_at: at(-25), updated_by: MOMENCE_ACTOR })]]);
    const [guest] = floorGuests(s, [booking({ checkedIn: true })], rows);
    expect(guest).toMatchObject({ checkedIn: true, checkedInAt: at(-25), estimated: false });
  });

  it('drops a Momence-sent time once they are un-checked in Momence', () => {
    const rows = new Map([['1', row({ updated_by: MOMENCE_ACTOR })]]);
    const [guest] = floorGuests(s, [booking({ checkedIn: false })], rows);
    expect(guest).toMatchObject({ checkedIn: false, checkedInAt: null });
  });

  it('keeps a time recorded here even if Momence lost the check-in', () => {
    const [guest] = floorGuests(s, [booking({ checkedIn: false })], new Map([['1', row()]]));
    expect(guest).toMatchObject({ checkedIn: true, checkedInAt: at(-20) });
  });

  it('carries a check-out', () => {
    const rows = new Map([
      ['1', row({ checked_out_at: at(-5), checked_out_by: 'staff@pyresauna.com' })],
    ]);
    const [guest] = floorGuests(s, [booking({ checkedIn: true })], rows);
    expect(guest).toMatchObject({ checkedIn: true, checkedOutAt: at(-5) });
  });

  it('drops cancelled bookings', () => {
    expect(floorGuests(s, [booking({ cancelledAt: at(-60) })], new Map())).toEqual([]);
  });
});

const WARNING = DEFAULT_CHECKPOINTS;
const guestAt = (offset: number, done: Record<string, { at: string; by: string }> = {}) => ({
  checkedInAt: at(offset),
  minutes: 60,
  checkpointsDone: done,
});

describe('floorTiming', () => {
  it('is in progress with nothing due', () => {
    const t = floorTiming(guestAt(-30), WARNING, NOW);
    expect(t.status).toBe('in');
    expect(t.progress).toBeCloseTo(0.5);
    expect(t.remainingMs).toBe(min(30));
    expect(t.checkpoints[0]).toMatchObject({ dueAt: NOW + min(15), due: false });
  });

  it('calls for the warning at 15 minutes left', () => {
    expect(floorTiming(guestAt(-45), WARNING, NOW).status).toBe('due');
    expect(floorTiming(guestAt(-44), WARNING, NOW).status).toBe('in');
  });

  it('stops calling for a check-in once it is marked done', () => {
    const done = { 'warning-15': { at: at(-1), by: 'staff@pyresauna.com' } };
    const t = floorTiming(guestAt(-50, done), WARNING, NOW);
    expect(t.status).toBe('in');
    expect(t.checkpoints[0].done).toEqual(done['warning-15']);
  });

  it('times check-ins from arrival, before the end, and after the end', () => {
    const points: Checkpoint[] = [
      { id: 'after', label: 'Out?', minutes: 10, from: 'after_end' },
      { id: 'water', label: 'Water', minutes: 20, from: 'after_arrival' },
      { id: 'warn', label: 'Warning', minutes: 15, from: 'before_end' },
    ];
    const t = floorTiming(guestAt(0), points, NOW);
    expect(t.checkpoints.map((c) => [c.checkpoint.id, (c.dueAt - NOW) / min(1)])).toEqual([
      ['water', 20],
      ['warn', 45],
      ['after', 70],
    ]);
  });

  it('is over once their time is up with nothing due, capped at a full bar', () => {
    const t = floorTiming(guestAt(-70), [], NOW);
    expect(t.status).toBe('over');
    expect(t.progress).toBe(1);
    expect(t.remainingMs).toBe(-min(10));
  });

  it('is waiting without a check-in', () => {
    const t = floorTiming({ checkedInAt: null, minutes: 60, checkpointsDone: {} }, WARNING, NOW);
    expect(t.status).toBe('waiting');
  });

  it('keeps a guest listed half an hour past their end or last check-in', () => {
    expect(onFloor(floorTiming(guestAt(-80), [], NOW), NOW)).toBe(true);
    expect(onFloor(floorTiming(guestAt(-91), [], NOW), NOW)).toBe(false);
    const late: Checkpoint[] = [{ id: 'late', label: 'Late', minutes: 20, from: 'after_end' }];
    const done = { late: { at: at(-1), by: 'staff@pyresauna.com' } };
    expect(onFloor(floorTiming(guestAt(-100, done), late, NOW), NOW)).toBe(true);
  });

  it('keeps a guest listed while a check-in is still due', () => {
    expect(onFloor(floorTiming(guestAt(-200), WARNING, NOW), NOW)).toBe(true);
  });

  it('sorts due check-ins first, then overtime, then by time left', () => {
    const done = { 'warning-15': { at: at(-1), by: 'staff@pyresauna.com' } };
    const timings = [
      floorTiming(guestAt(-10), WARNING, NOW),
      floorTiming(guestAt(-65, done), WARNING, NOW),
      floorTiming(guestAt(-50), WARNING, NOW),
      floorTiming(guestAt(-30), WARNING, NOW),
    ];
    const sorted = [...timings].sort(compareFloor);
    expect(sorted.map((t) => t.status)).toEqual(['due', 'over', 'in', 'in']);
    expect(sorted[2].remainingMs).toBe(min(30));
  });
});

describe('parseCheckpoints', () => {
  it('accepts a list and trims labels', () => {
    expect(
      parseCheckpoints([{ id: 'a', label: ' Water ', minutes: 20, from: 'after_arrival' }])
    ).toEqual({
      ok: true,
      value: [{ id: 'a', label: 'Water', minutes: 20, from: 'after_arrival' }],
    });
    expect(parseCheckpoints([])).toEqual({ ok: true, value: [] });
  });

  it('rejects duplicate ids, blank labels, bad minutes, and unknown starting points', () => {
    const ok = { id: 'a', label: 'Water', minutes: 20, from: 'after_arrival' };
    expect(parseCheckpoints([ok, ok]).ok).toBe(false);
    expect(parseCheckpoints([{ ...ok, label: '  ' }]).ok).toBe(false);
    expect(parseCheckpoints([{ ...ok, minutes: -1 }]).ok).toBe(false);
    expect(parseCheckpoints([{ ...ok, minutes: 2.5 }]).ok).toBe(false);
    expect(parseCheckpoints([{ ...ok, from: 'whenever' }]).ok).toBe(false);
    expect(parseCheckpoints('water').ok).toBe(false);
  });
});

describe('moves between sessions', () => {
  // Arrived at -50 for a two-hour session; at -10, cancelled and rebooked
  // into a one-hour one that started at the same time.
  const [long, short] = floorSessions(
    [
      { ...session(20, -50, 120), id: 20, name: 'Two hours' },
      { ...session(21, -50, 60), id: 21, name: 'One hour' },
    ],
    NOW
  );
  const sessions = new Map([
    [long.id, long],
    [short.id, short],
  ]);
  const done = { 'warning-15': { at: at(-12), by: 'staff@pyresauna.com' } };
  const oldBooking = booking({
    id: 100,
    checkedIn: true,
    cancelledAt: at(-10),
    createdAt: at(-60),
  });
  const newBooking = booking({ id: 101, checkedIn: true, createdAt: at(-9) });
  const oldRow = row({
    booking_id: '100',
    session_id: '20',
    checked_in_at: at(-50),
    checkpoints_done: done,
  });
  const seats: FloorSeat[] = [
    { session: long, booking: oldBooking },
    { session: short, booking: newBooking },
  ];
  const rows = new Map([['100', oldRow]]);
  const moveOf = (s: FloorSeat[], r = rows) => findMoves(s, r).moves.get('101');

  it('carries the arrival time and done check-ins to the new booking', () => {
    expect(moveOf(seats)).toEqual({
      fromBookingId: '100',
      fromSessionId: '20',
      arrivedAt: at(-50),
      checkpointsDone: done,
    });
  });

  it('uses the estimate when the old booking was checked in without a recorded time', () => {
    expect(moveOf(seats, new Map())?.arrivedAt).toBe(long.startsAt);
  });

  it('carries a move made at the end of the hour, long after the old booking', () => {
    const late = booking({ id: 101, checkedIn: true, createdAt: at(5) });
    const cancelledLate = { ...oldBooking, cancelledAt: at(6) };
    expect(
      moveOf([
        { session: long, booking: cancelledLate },
        { session: short, booking: late },
      ])?.arrivedAt
    ).toBe(at(-50));
  });

  it('lets the latest live booking win when the old one is not cancelled yet', () => {
    const stillLive = { ...oldBooking, cancelledAt: null };
    const found = findMoves(
      [
        { session: long, booking: stillLive },
        { session: short, booking: newBooking },
      ],
      rows
    );
    expect(found.superseded).toEqual(new Set(['100']));
    expect(found.moves.get('101')?.arrivedAt).toBe(at(-50));
    const guests = floorGuests(long, [stillLive], rows, found, sessions);
    expect(guests).toEqual([]);
  });

  it('keeps the first arrival across two moves', () => {
    const [middle] = floorSessions([{ ...session(22, -50, 90), id: 22 }], NOW);
    const second = booking({ id: 102, checkedIn: true, cancelledAt: at(-5), createdAt: at(-20) });
    const secondRow = row({ booking_id: '102', session_id: '22', checked_in_at: at(-20) });
    const found = findMoves(
      [
        { session: long, booking: { ...oldBooking, cancelledAt: at(-20) } },
        { session: middle, booking: second },
        { session: short, booking: { ...newBooking, createdAt: at(-5) } },
      ],
      new Map([
        ['100', oldRow],
        ['102', secondRow],
      ])
    );
    expect(found.moves.get('101')).toMatchObject({ fromBookingId: '102', arrivedAt: at(-50) });
  });

  it('starts a fresh clock for a session that does not overlap', () => {
    const [later] = floorSessions([{ ...session(23, 70, 60), id: 23 }], NOW + min(120));
    const next = booking({ id: 101, checkedIn: true, createdAt: at(-9) });
    expect(
      findMoves(
        [
          { session: long, booking: oldBooking },
          { session: later, booking: next },
        ],
        rows
      ).moves.size
    ).toBe(0);
  });

  it('ignores a cancelled booking they never arrived for', () => {
    const neverCame = booking({ id: 100, checkedIn: false, cancelledAt: at(-10) });
    expect(moveOf([{ session: long, booking: neverCame }, seats[1]], new Map())).toBeUndefined();
  });

  it('ignores a different guest', () => {
    const other = booking({
      id: 101,
      checkedIn: true,
      createdAt: at(-9),
      member: { id: 8, firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com' },
    });
    expect(moveOf([seats[0], { session: short, booking: other }])).toBeUndefined();
  });

  it('does not carry a move twice', () => {
    const move = moveOf(seats);
    if (!move) throw new Error('expected a move');
    const carried = movedRow(seats[1], move, null, at(0));
    expect(
      moveOf(
        seats,
        new Map([
          ['100', oldRow],
          ['101', carried],
        ])
      )
    ).toBeUndefined();
  });

  it('shows the moved guest with their original time on the new session length', () => {
    const move = moveOf(seats);
    if (!move) throw new Error('expected a move');
    const carried = movedRow(seats[1], move, null, at(0));
    expect(carried).toMatchObject({ updated_by: MOVE_ACTOR, moved_from_booking_id: '100' });
    const [guest] = floorGuests(
      short,
      [newBooking],
      new Map([['101', carried]]),
      undefined,
      sessions
    );
    expect(guest).toMatchObject({
      checkedInAt: at(-50),
      minutes: 60,
      checkpointsDone: done,
      movedFrom: { sessionId: '20', sessionName: 'Two hours', sessionMinutes: 120 },
    });
  });

  it('says a rebooked guest not yet checked in is a move', () => {
    const waiting = booking({ id: 101, checkedIn: false, createdAt: at(-9) });
    const found = findMoves([seats[0], { session: short, booking: waiting }], rows);
    const [guest] = floorGuests(short, [waiting], new Map(), found, sessions);
    expect(guest).toMatchObject({
      checkedIn: false,
      movedFrom: { sessionName: 'Two hours', arrivedAt: at(-50) },
    });
  });
});

describe('check-outs and moves', () => {
  const [long, short] = floorSessions(
    [
      { ...session(20, -50, 120), id: 20 },
      { ...session(21, -50, 60), id: 21 },
    ],
    NOW
  );
  it('treats a booking after a check-out as a new visit', () => {
    const left = booking({ id: 100, checkedIn: true, cancelledAt: at(-10), createdAt: at(-60) });
    const rows = new Map([
      ['100', row({ booking_id: '100', checked_in_at: at(-50), checked_out_at: at(-20) })],
    ]);
    const found = findMoves(
      [
        { session: long, booking: left },
        { session: short, booking: booking({ id: 101, checkedIn: true, createdAt: at(-9) }) },
      ],
      rows
    );
    expect(found.moves.size).toBe(0);
  });
});

describe('parseSessionLengths', () => {
  it('sorts and de-duplicates whole minutes', () => {
    expect(parseSessionLengths([120, 60, 60, 90])).toEqual({ ok: true, value: [60, 90, 120] });
  });

  it('rejects an empty list, fractions, and out-of-range minutes', () => {
    expect(parseSessionLengths([]).ok).toBe(false);
    expect(parseSessionLengths([62.5]).ok).toBe(false);
    expect(parseSessionLengths([2]).ok).toBe(false);
    expect(parseSessionLengths([601]).ok).toBe(false);
    expect(parseSessionLengths('60').ok).toBe(false);
  });
});
