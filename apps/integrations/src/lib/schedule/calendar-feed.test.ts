// What an employee's calendar actually says about their shift. The UID rules
// matter most: a stable one means an edited shift moves in place, and the
// assignment-keyed choice is what makes a sub swap land in the right person's
// calendar.

import { DEFAULT_DUTY_CATALOG, type DutyAssignmentRow } from '@pyre/schedule-core';
import { describe, expect, it } from 'vitest';
import { generateIcsCalendar } from '@/lib/calendar/ics';
import type { ShiftAssignmentRow, StaffRow } from '@/lib/db';
import {
  buildDutyEvents,
  buildPaydayEvents,
  buildPersonalEvents,
  buildTeamEvents,
  type ShiftWithAssignments,
} from './calendar-feed';

const ORIGIN = 'https://pyre-integrations.vercel.app';
const ME = 'staff-me';
const THEM = 'staff-them';

const staffById = new Map<string, StaffRow>([
  [ME, { id: ME, display_name: 'Sunny' } as StaffRow],
  [THEM, { id: THEM, display_name: 'Julien' } as StaffRow],
]);

const assignment = (over: Partial<ShiftAssignmentRow> = {}): ShiftAssignmentRow =>
  ({
    id: 'assign-1',
    shift_id: 'shift-1',
    staff_id: ME,
    starts_at: '14:00:00',
    ends_at: '20:30:00',
    duties: [],
    notes: null,
    is_draft: false,
    updated_at: '2026-08-13T14:22:11.000Z',
    ...over,
  }) as ShiftAssignmentRow;

const shift = (over: Partial<ShiftWithAssignments> = {}): ShiftWithAssignments =>
  ({
    id: 'shift-1',
    shift_date: '2026-08-14',
    label: 'Evening',
    starts_at: '14:00:00',
    ends_at: '20:30:00',
    staff_needed: 2,
    notes: null,
    status: 'active',
    is_draft: false,
    updated_at: '2026-08-13T14:22:11.000Z',
    assignments: [assignment()],
    ...over,
  }) as ShiftWithAssignments;

const personal = (s: ShiftWithAssignments) =>
  buildPersonalEvents({
    staffId: ME,
    shifts: [s],
    staffById,
    origin: ORIGIN,
    dutyCatalog: DEFAULT_DUTY_CATALOG,
  });

describe('buildPersonalEvents', () => {
  it('emits one event per shift the person is on', () => {
    const [event] = personal(shift());
    expect(event.uid).toBe('pyre-shift-assign-1@pyresauna.com');
    expect(event.date).toBe('2026-08-14');
    expect(event.summary).toBe('Pyre — Evening');
    expect(event.status).toBe('CONFIRMED');
    expect(event.url).toBe(`${ORIGIN}/admin/schedule?view=week&date=2026-08-14&shift=shift-1`);
  });

  it('skips shifts the person is not assigned to', () => {
    expect(personal(shift({ assignments: [assignment({ staff_id: THEM })] }))).toEqual([]);
  });

  it('uses the assignment window, not the shift window', () => {
    // Someone in for the front of the shift only.
    const [event] = personal(
      shift({
        assignments: [assignment({ starts_at: '14:00:00', ends_at: '16:00:00' })],
      })
    );
    expect(event).toMatchObject({ startTime: '14:00:00', endTime: '16:00:00' });
    expect(event.summary).toBe('Pyre — Evening');
  });

  it('names coworkers, and says so when there are none', () => {
    const withThem = personal(
      shift({ assignments: [assignment(), assignment({ id: 'assign-2', staff_id: THEM })] })
    );
    expect(withThem[0].description).toContain('With: Julien');
    expect(personal(shift())[0].description).toContain('on your own');
  });

  it('excludes draft shifts and draft assignments', () => {
    expect(personal(shift({ is_draft: true }))).toEqual([]);
    expect(personal(shift({ assignments: [assignment({ is_draft: true })] }))).toEqual([]);
  });

  it('keeps a cancelled shift as a cancelled event rather than dropping it', () => {
    const [event] = personal(shift({ status: 'cancelled' }));
    expect(event.status).toBe('CANCELLED');
    expect(event.description).toContain('cancelled');
  });

  it('lists the duties they hold, and stays quiet when there are none', () => {
    const [event] = personal(
      shift({ assignments: [assignment({ duties: ['breakdown_b', 'setup_a'] })] })
    );
    expect(event.description).toContain('Duties: Set Up (A) · Break Down (B)');
    expect(personal(shift())[0].description).not.toContain('Duties:');
  });

  it('carries shift notes into the description', () => {
    const [event] = personal(shift({ notes: 'Deep clean after close' }));
    expect(event.description).toContain('Notes: Deep clean after close');
  });

  it('keeps the UID stable when unrelated fields change', () => {
    const before = personal(shift())[0].uid;
    const after = personal(shift({ label: 'Renamed', starts_at: '15:00:00' }))[0].uid;
    expect(after).toBe(before);
  });

  it('changes the UID when the assignment itself is replaced (a sub swap)', () => {
    const [event] = personal(shift({ assignments: [assignment({ id: 'assign-new' })] }));
    expect(event.uid).toBe('pyre-shift-assign-new@pyresauna.com');
  });
});

describe('buildPersonalEvents on-call', () => {
  it("adds an all-day on-call event for a day they aren't working", () => {
    const [event] = personal(
      shift({ on_call_staff_id: ME, assignments: [assignment({ staff_id: THEM })] })
    );
    expect(event.uid).toBe('pyre-oncall-2026-08-14@pyresauna.com');
    expect(event.allDay).toBe(true);
    expect(event.date).toBe('2026-08-14');
    expect(event.summary).toBe('Pyre — On call');
    expect(event.description).toContain("You're on call all day");
    expect(event.description).toContain('Evening 2p–8:30p: Julien');
    expect(event.url).toBe(`${ORIGIN}/admin/schedule?view=week&date=2026-08-14`);
  });

  it('keeps the shift a plain timed event and adds the on-call day beside it', () => {
    const events = personal(shift({ on_call_staff_id: ME }));
    expect(events).toHaveLength(2);
    const [work, onCall] = events;
    expect(work.uid).toBe('pyre-shift-assign-1@pyresauna.com');
    expect(work.allDay).toBeFalsy();
    expect(work.summary).toBe('Pyre — Evening');
    expect(work.description).toContain("You're on call today.");
    expect(onCall.allDay).toBe(true);
  });

  it('adds one on-call event per day, however many shifts it has', () => {
    const events = buildPersonalEvents({
      staffId: ME,
      shifts: [
        shift({ id: 'am', on_call_staff_id: ME, assignments: [] }),
        shift({ id: 'pm', on_call_staff_id: ME, assignments: [], starts_at: '17:00:00' }),
      ],
      staffById,
      origin: ORIGIN,
      dutyCatalog: DEFAULT_DUTY_CATALOG,
    });
    expect(events.filter((e) => e.allDay)).toHaveLength(1);
  });

  it("tells the crew who's on call", () => {
    const events = personal(shift({ on_call_staff_id: THEM }));
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe('Pyre — Evening');
    expect(events[0].description).toContain('On call today: Julien');
  });

  it("cancels the on-call day when the day's shifts are cancelled", () => {
    const [event] = personal(shift({ on_call_staff_id: ME, status: 'cancelled', assignments: [] }));
    expect(event.allDay).toBe(true);
    expect(event.status).toBe('CANCELLED');
  });

  it('bumps the last-modified stamp when on-call changes on the shift', () => {
    const [event] = personal(
      shift({ on_call_staff_id: THEM, updated_at: '2026-08-20T09:00:00.000Z' })
    );
    expect(event.lastModified).toBe('2026-08-20T09:00:00.000Z');
  });
});

describe('buildTeamEvents', () => {
  const team = (s: ShiftWithAssignments) =>
    buildTeamEvents({ shifts: [s], staffById, origin: ORIGIN });

  it('shows coverage in the title and lists who is on', () => {
    const [event] = team(
      shift({ assignments: [assignment(), assignment({ id: 'assign-2', staff_id: THEM })] })
    );
    expect(event.uid).toBe('pyre-cover-shift-1@pyresauna.com');
    expect(event.summary).toBe('Evening — 2/2');
    expect(event.description).toContain('On shift: Sunny, Julien');
  });

  it("names who's on call in the shift and as an all-day event", () => {
    const [cover, onCall] = team(shift({ on_call_staff_id: THEM }));
    expect(cover.description).toContain('On call today: Julien');
    expect(onCall.allDay).toBe(true);
    expect(onCall.uid).toBe('pyre-oncall-day-2026-08-14@pyresauna.com');
    expect(onCall.summary).toBe('On call: Julien');
    const plain = team(shift());
    expect(plain).toHaveLength(1);
    expect(plain[0].description).not.toContain('On call');
  });

  it('flags an understaffed shift', () => {
    const [event] = team(shift());
    expect(event.summary).toBe('⚠ Evening — 1/2');
    expect(event.description).toContain('Needs 1 more.');
  });

  it('does not flag a cancelled shift as understaffed', () => {
    const [event] = team(shift({ status: 'cancelled', assignments: [] }));
    expect(event.summary).toBe('Evening — 0/2');
    expect(event.status).toBe('CANCELLED');
  });

  it('uses the shift window and includes shifts with nobody on them', () => {
    const [event] = team(shift({ assignments: [] }));
    expect(event).toMatchObject({ startTime: '14:00:00', endTime: '20:30:00' });
    expect(event.description).toContain('Nobody assigned yet.');
  });

  it('excludes drafts', () => {
    expect(team(shift({ is_draft: true }))).toEqual([]);
  });
});

describe('buildPaydayEvents', () => {
  const events = buildPaydayEvents({ paydays: ['2026-10-26', '2026-11-09'], origin: ORIGIN });

  it('makes one all-day event per payday, keyed on the date', () => {
    expect(events.map((e) => [e.uid, e.date, e.allDay, e.summary])).toEqual([
      ['pyre-payday-2026-10-26@pyresauna.com', '2026-10-26', true, 'Pyre — Payday'],
      ['pyre-payday-2026-11-09@pyresauna.com', '2026-11-09', true, 'Pyre — Payday'],
    ]);
  });

  it('leaves the location off the event', () => {
    const ics = generateIcsCalendar({ calendarName: 'Pyre — My Shifts', events });
    expect(ics).toContain('DTSTART;VALUE=DATE:20261026');
    expect(ics).not.toMatch(/^LOCATION:/m);
  });
});

describe('buildDutyEvents', () => {
  const duty = (over: Partial<DutyAssignmentRow> = {}): DutyAssignmentRow =>
    ({
      id: 'duty-1',
      duty_key: 'host',
      duty_date: '2026-08-17',
      staff_id: ME,
      notes: null,
      done_at: null,
      updated_at: '2026-08-13T14:22:11.000Z',
      ...over,
    }) as DutyAssignmentRow;

  it('makes an all-day event per off-shift duty of theirs, keyed on the row', () => {
    const events = buildDutyEvents({
      staffId: ME,
      dutyAssignments: [duty(), duty({ id: 'duty-2', staff_id: THEM })],
      dutyCatalog: DEFAULT_DUTY_CATALOG,
      origin: ORIGIN,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      uid: 'pyre-duty-duty-1@pyresauna.com',
      date: '2026-08-17',
      allDay: true,
      summary: 'Pyre — Host',
      url: `${ORIGIN}/admin/schedule?view=week&date=2026-08-17`,
    });
    expect(events[0].description).toContain(`${ORIGIN}/admin/sops/host-responsibilities`);
  });
});
