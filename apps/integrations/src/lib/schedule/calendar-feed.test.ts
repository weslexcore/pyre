// What an employee's calendar actually says about their shift. The UID rules
// matter most: a stable one means an edited shift moves in place, and the
// assignment-keyed choice is what makes a sub swap land in the right person's
// calendar.

import { describe, expect, it } from 'vitest';
import type { ShiftAssignmentRow, StaffRow } from '@/lib/db';
import { buildPersonalEvents, buildTeamEvents, type ShiftWithAssignments } from './calendar-feed';

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
    role: 'full',
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
  buildPersonalEvents({ staffId: ME, shifts: [s], staffById, origin: ORIGIN });

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
    // A Setup role covers the front of the shift only.
    const [event] = personal(
      shift({
        assignments: [assignment({ role: 'setup', starts_at: '14:00:00', ends_at: '16:00:00' })],
      })
    );
    expect(event.startTime).toBe('14:00:00');
    expect(event.endTime).toBe('16:00:00');
    expect(event.summary).toBe('Pyre — Evening (Setup)');
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
      shift({ assignments: [assignment({ duties: ['breakdown_b', 'setup'] })] })
    );
    expect(event.description).toContain('Duties: Setup · Break Down (B)');
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
    expect(event.startTime).toBe('14:00:00');
    expect(event.endTime).toBe('20:30:00');
    expect(event.description).toContain('Nobody assigned yet.');
  });

  it('excludes drafts', () => {
    expect(team(shift({ is_draft: true }))).toEqual([]);
  });
});
