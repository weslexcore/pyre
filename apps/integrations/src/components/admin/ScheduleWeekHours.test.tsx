// The week-hours rollup behind the board's hours panel: one week only,
// drafts apart from live, zero-hour roster members kept, off-roster people
// only when they still have hours — and the list marks over-target people.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ShiftAssignmentRow, ShiftRow, StaffRow } from '@/lib/db';
import { shiftPrefLine, WeekHoursList, weekHoursRows } from './ScheduleWeekHours';

const person = (id: string, over: Partial<StaffRow> = {}): StaffRow => ({
  id,
  email: `${id}@pyresauna.com`,
  display_name: id,
  is_founder: false,
  is_shift_lead: false,
  active: true,
  is_admin: false,
  pages: [],
  momence_member_id: null,
  added_by: null,
  calendar_token: null,
  pay_rate: null,
  target_hours_per_week: null,
  min_shifts_per_week: null,
  preferred_shifts_per_week: null,
  max_shifts_per_week: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
});

const assignment = (
  staffId: string,
  startsAt: string,
  endsAt: string,
  isDraft = false
): ShiftAssignmentRow => ({
  id: `${staffId}-${startsAt}`,
  shift_id: 'shift',
  staff_id: staffId,
  duties: [],
  starts_at: startsAt,
  ends_at: endsAt,
  is_draft: isDraft,
  notes: null,
  proposal_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const shift = (
  date: string,
  assignments: ShiftAssignmentRow[],
  over: Partial<ShiftRow> = {}
): ShiftRow & { assignments: ShiftAssignmentRow[] } => ({
  id: `shift-${date}-${assignments.length}`,
  shift_date: date,
  label: 'Evening',
  starts_at: '16:00',
  ends_at: '22:00',
  staff_needed: 2,
  source: 'manual',
  momence_session_ids: [],
  sync_locked: false,
  notes: null,
  status: 'active',
  proposal_id: null,
  is_draft: false,
  sync_flag: null,
  sessions_start_at: null,
  sessions_end_at: null,
  confirmed_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
  assignments,
});

// 2026-09-14 is a Monday.
const WEEK = '2026-09-14';

describe('weekHoursRows', () => {
  it('sums only the given week, keeps zero-hour roster members, sorts heaviest first', () => {
    const staff = [person('ana'), person('ben'), person('cal')];
    const shifts = [
      shift('2026-09-15', [assignment('ben', '16:00', '22:00')]),
      shift('2026-09-19', [
        assignment('ben', '10:00', '14:00'),
        assignment('ana', '10:00', '13:00'),
      ]),
      // The Monday after — next week, not this one.
      shift('2026-09-21', [assignment('cal', '10:00', '20:00')]),
    ];
    const { rows, totals } = weekHoursRows(staff, shifts, WEEK);
    expect(rows.map((r) => [r.staff.id, r.live])).toEqual([
      ['ben', 10],
      ['ana', 3],
      ['cal', 0],
    ]);
    expect(totals).toEqual({ live: 13, draft: 0, shifts: 2, scheduled: 2 });
  });

  it('keeps draft hours apart and skips cancelled shifts', () => {
    const staff = [person('ana')];
    const shifts = [
      shift('2026-09-15', [assignment('ana', '16:00', '22:00')]),
      shift('2026-09-16', [assignment('ana', '16:00', '20:00', true)], { is_draft: true }),
      shift('2026-09-17', [assignment('ana', '16:00', '22:00')], { status: 'cancelled' }),
    ];
    const { rows, totals } = weekHoursRows(staff, shifts, WEEK);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ live: 6, draft: 4, liveShifts: 1, draftShifts: 1 });
    expect(totals).toEqual({ live: 6, draft: 4, shifts: 1, scheduled: 1 });
  });

  it('lists an off-roster person only while they still have hours', () => {
    const gone = person('gone', { active: false });
    const { rows: withHours } = weekHoursRows(
      [gone],
      [shift('2026-09-15', [assignment('gone', '16:00', '18:00')])],
      WEEK
    );
    expect(withHours.map((r) => r.staff.id)).toEqual(['gone']);
    expect(weekHoursRows([gone], [], WEEK).rows).toEqual([]);
  });
});

describe('WeekHoursList', () => {
  it('shows hours against the target and flags going over it', () => {
    const { rows, totals } = weekHoursRows(
      [person('ana', { target_hours_per_week: 8 })],
      [shift('2026-09-15', [assignment('ana', '10:00', '20:00')])],
      WEEK
    );
    const html = renderToStaticMarkup(
      <WeekHoursList rows={rows} totals={totals} selected={new Set()} onToggle={() => {}} />
    );
    expect(html).toContain('10 / 8h');
    expect(html).toContain('2h over target');
    expect(html).toContain('text-[var(--pyre-red)]');
  });

  it('marks the people in the board filter', () => {
    const { rows, totals } = weekHoursRows([person('ana'), person('ben')], [], WEEK);
    const html = renderToStaticMarkup(
      <WeekHoursList rows={rows} totals={totals} selected={new Set(['ben'])} onToggle={() => {}} />
    );
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain('0 of 2');
  });
});

describe('shiftPrefLine', () => {
  it('says nothing for someone with no shift preferences', () => {
    expect(shiftPrefLine(person('ana'), 3)).toBeNull();
  });

  it('reads the count against preferred and range, toned by where it lands', () => {
    const ana = person('ana', {
      min_shifts_per_week: 2,
      preferred_shifts_per_week: 3,
      max_shifts_per_week: 4,
    });
    expect(shiftPrefLine(ana, 3)).toEqual({
      text: '3 shifts · want 3 (2–4)',
      tone: 'text-[var(--pyre-sage)]',
    });
    expect(shiftPrefLine(ana, 1)?.tone).toBe('text-[var(--pyre-gold)]');
    expect(shiftPrefLine(ana, 5)?.tone).toBe('text-[var(--pyre-red)]');
    expect(shiftPrefLine(ana, 4)?.tone).toBe('text-white/50');
  });

  it('handles a lone bound', () => {
    expect(shiftPrefLine(person('ben', { max_shifts_per_week: 2 }), 1)?.text).toBe(
      '1 shift · (max 2)'
    );
  });

  it('shows in the list, counting draft assignments', () => {
    const { rows, totals } = weekHoursRows(
      [person('ana', { preferred_shifts_per_week: 2 })],
      [
        shift('2026-09-15', [assignment('ana', '16:00', '22:00')]),
        shift('2026-09-16', [assignment('ana', '16:00', '22:00', true)], { is_draft: true }),
      ],
      WEEK
    );
    const html = renderToStaticMarkup(
      <WeekHoursList rows={rows} totals={totals} selected={new Set()} onToggle={() => {}} />
    );
    expect(html).toContain('2 shifts · want 2');
  });
});
