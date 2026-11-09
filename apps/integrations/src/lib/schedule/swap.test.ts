import { describe, expect, it } from 'vitest';
import { subRequestText } from '@/lib/notifications/text';
import { swappableShifts } from './swap';

// --- Which of my shifts can I offer against a sub request? -----------------

const TODAY = '2026-08-17';

const shift = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  label: 'Evening',
  shift_date: '2026-08-20',
  starts_at: '14:30',
  ends_at: '20:30',
  status: 'active' as const,
  is_draft: false,
  ...over,
});

const mine = (shift_id: string, over: Record<string, unknown> = {}) => ({
  shift_id,
  starts_at: '14:30',
  ends_at: '20:30',
  is_draft: false,
  ...over,
});

const sub = { shift_id: 'requested', requester_staff_id: 'requester' };

const base = {
  sub,
  requesterShiftIds: new Set<string>(),
  offererOpenSubShiftIds: new Set<string>(),
  timeOff: [],
  today: TODAY,
};

describe('swappableShifts', () => {
  it('offers a live upcoming shift the requester is free for', () => {
    const out = swappableShifts({
      ...base,
      offererAssignments: [mine('s1')],
      shiftsById: new Map([['s1', shift('s1')]]),
    });
    expect(out).toEqual([
      {
        shiftId: 's1',
        label: 'Evening',
        shift_date: '2026-08-20',
        starts_at: '14:30',
        ends_at: '20:30',
      },
    ]);
  });

  it('never offers the requested shift itself', () => {
    const out = swappableShifts({
      ...base,
      offererAssignments: [mine('requested')],
      shiftsById: new Map([['requested', shift('requested')]]),
    });
    expect(out).toEqual([]);
  });

  it('skips drafts, cancelled shifts, and shifts already behind us', () => {
    const out = swappableShifts({
      ...base,
      offererAssignments: [
        mine('draft-assignment', { is_draft: true }),
        mine('draft-shift'),
        mine('cancelled'),
        mine('past'),
        mine('today'),
      ],
      shiftsById: new Map([
        ['draft-assignment', shift('draft-assignment')],
        ['draft-shift', shift('draft-shift', { is_draft: true })],
        ['cancelled', shift('cancelled', { status: 'cancelled' })],
        ['past', shift('past', { shift_date: '2026-08-16' })],
        ['today', shift('today', { shift_date: TODAY })],
      ]),
    });
    expect(out.map((c) => c.shiftId)).toEqual(['today']);
  });

  it("skips shifts the requester is already on, and ones I've asked off myself", () => {
    const out = swappableShifts({
      ...base,
      offererAssignments: [mine('theirs-too'), mine('my-sub'), mine('ok')],
      shiftsById: new Map([
        ['theirs-too', shift('theirs-too')],
        ['my-sub', shift('my-sub')],
        ['ok', shift('ok')],
      ]),
      requesterShiftIds: new Set(['theirs-too']),
      offererOpenSubShiftIds: new Set(['my-sub']),
    });
    expect(out.map((c) => c.shiftId)).toEqual(['ok']);
  });

  it("skips shifts that overlap the requester's time off, including the sub's own blackout", () => {
    const blackout = {
      id: 'to-1',
      staff_id: 'requester',
      kind: 'range' as const,
      start_date: '2026-08-20',
      end_date: '2026-08-20',
      days_of_week: [],
      starts_at: '14:30',
      ends_at: '20:30',
      note: 'Requested a sub',
      is_emergency: false,
      created_by: 'staff' as const,
      created_at: '',
      updated_at: '',
    };
    const out = swappableShifts({
      ...base,
      offererAssignments: [mine('same-day-overlap'), mine('same-day-morning')],
      shiftsById: new Map([
        ['same-day-overlap', shift('same-day-overlap')],
        ['same-day-morning', shift('same-day-morning', { label: 'Morning' })],
      ]),
      timeOff: [blackout as never],
    }).map((c) => c.shiftId);
    // Overlap is judged by the offerer's hours on the shift, not the shift's.
    expect(out).toEqual([]);
    const morning = swappableShifts({
      ...base,
      offererAssignments: [mine('same-day-morning', { starts_at: '08:30', ends_at: '14:00' })],
      shiftsById: new Map([['same-day-morning', shift('same-day-morning', { label: 'Morning' })]]),
      timeOff: [blackout as never],
    }).map((c) => c.shiftId);
    expect(morning).toEqual(['same-day-morning']);
  });

  it('sorts by date then start time', () => {
    const out = swappableShifts({
      ...base,
      offererAssignments: [
        mine('late', { starts_at: '16:00', ends_at: '22:00' }),
        mine('early', { starts_at: '08:00', ends_at: '14:00' }),
        mine('sooner'),
      ],
      shiftsById: new Map([
        ['late', shift('late', { shift_date: '2026-08-22' })],
        ['early', shift('early', { shift_date: '2026-08-22' })],
        ['sooner', shift('sooner', { shift_date: '2026-08-19' })],
      ]),
    });
    expect(out.map((c) => c.shiftId)).toEqual(['sooner', 'early', 'late']);
  });
});

// --- The words the swap notices use ----------------------------------------

describe('subRequestText for swap events', () => {
  const requested = {
    label: 'Evening',
    shift_date: '2026-08-20',
    starts_at: '14:30',
    ends_at: '20:30',
  };
  const offered = {
    label: 'Morning',
    shift_date: '2026-08-22',
    starts_at: '08:30',
    ends_at: '14:30',
  };
  const common = {
    shift: requested,
    window: requested,
    requesterName: 'Sunny',
    claimerName: 'Omar',
    offeredShift: offered,
    offeredWindow: offered,
  };

  it('tells the requester who offered what', () => {
    expect(subRequestText({ ...common, event: 'swap_offered', forRequester: true })).toEqual({
      title: 'Omar offered to swap shifts with you',
      body: "They take 'Evening' on Thu, Aug 20, 2:30p–8:30p; you take 'Morning' on Sat, Aug 22, 8:30a–2:30p",
    });
  });

  it('tells the admins both sides of an offer', () => {
    expect(subRequestText({ ...common, event: 'swap_offered' }).title).toBe(
      'Omar offered Sunny a swap'
    );
  });

  it('tells the offerer their swap was accepted, and the admins who swapped', () => {
    expect(subRequestText({ ...common, event: 'swap_accepted', forOfferer: true }).title).toBe(
      'Sunny accepted your swap'
    );
    expect(subRequestText({ ...common, event: 'swap_accepted' }).title).toBe(
      'Omar and Sunny swapped shifts'
    );
  });

  it('tells the offerer the shift is still open after a decline', () => {
    expect(subRequestText({ ...common, event: 'swap_declined', forOfferer: true })).toEqual({
      title: 'Sunny declined your swap offer',
      body: "'Evening' on Thu, Aug 20, 2:30p–8:30p is still open to take outright",
    });
  });
});
