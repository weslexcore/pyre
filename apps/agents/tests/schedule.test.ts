// The schedule source's pure parts: the date window a call reads, the shape
// each shift takes (crew by name, the asker marked, hours), and the asker's
// weekly hours. The database reads around them live in getShifts and are
// exercised against a real Supabase, not here.

import type { ShiftAssignmentRow, ShiftRow } from '@pyre/schedule-core';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WINDOW_DAYS,
  findSelf,
  MAX_WINDOW_DAYS,
  myHoursByWeek,
  resolveWindow,
  type RosterRow,
  shapeShifts,
  weekdayOf,
} from '../agent/lib/knowledge/schedule';

const TODAY = '2026-09-03'; // a Thursday

describe('resolveWindow', () => {
  it('defaults to four weeks from today', () => {
    expect(resolveWindow({}, TODAY)).toEqual({ from: TODAY, to: '2026-09-30' });
    expect(DEFAULT_WINDOW_DAYS).toBe(28);
  });

  it('extends a single edge by the default span', () => {
    expect(resolveWindow({ from: '2026-08-01' }, TODAY)).toEqual({ from: '2026-08-01', to: '2026-08-28' });
    expect(resolveWindow({ to: '2026-08-28' }, TODAY)).toEqual({ from: '2026-08-01', to: '2026-08-28' });
  });

  it('keeps an explicit window, righting a reversed one', () => {
    expect(resolveWindow({ from: '2026-08-24', to: '2026-08-30' }, TODAY)).toEqual({
      from: '2026-08-24',
      to: '2026-08-30',
    });
    expect(resolveWindow({ from: '2026-08-30', to: '2026-08-24' }, TODAY)).toEqual({
      from: '2026-08-24',
      to: '2026-08-30',
    });
  });

  it('cuts a window wider than a year at the far end', () => {
    const { from, to } = resolveWindow({ from: '2025-01-01', to: '2027-12-31' }, TODAY);
    expect(from).toBe('2025-01-01');
    expect(to).toBe('2026-01-01'); // 366 days inclusive
    expect(MAX_WINDOW_DAYS).toBe(366);
  });
});

describe('weekdayOf', () => {
  it('names the day without a timezone shift', () => {
    expect(weekdayOf('2026-09-03')).toBe('Thu');
    expect(weekdayOf('2026-09-06')).toBe('Sun');
    expect(weekdayOf('2026-09-07')).toBe('Mon');
  });
});

const staff: RosterRow[] = [
  { id: 'sam', display_name: 'Sam', email: 'Sam@PyreSauna.com', is_founder: false, is_shift_lead: true, active: true },
  { id: 'ari', display_name: 'Ari', email: 'ari@pyresauna.com', is_founder: true, is_shift_lead: false, active: true },
  { id: 'nobody', display_name: 'No Email', email: null, is_founder: false, is_shift_lead: false, active: false },
];

describe('findSelf', () => {
  it('matches the scope email case-insensitively and never on an empty email', () => {
    expect(findSelf(staff, 'sam@pyresauna.com')?.id).toBe('sam');
    expect(findSelf(staff, '')).toBeNull();
    expect(findSelf(staff, 'someone@else.com')).toBeNull();
  });
});

const shift = (overrides: Partial<ShiftRow>): ShiftRow => ({
  id: 's1',
  shift_date: '2026-09-05',
  label: 'Morning',
  starts_at: '07:30:00',
  ends_at: '13:00:00',
  staff_needed: 2,
  source: 'momence',
  momence_session_ids: [],
  sync_locked: false,
  notes: null,
  status: 'active',
  proposal_id: null,
  is_draft: false,
  sync_flag: null,
  created_at: '',
  updated_at: '',
  ...overrides,
});

const assignment = (overrides: Partial<ShiftAssignmentRow>): ShiftAssignmentRow => ({
  id: 'a1',
  shift_id: 's1',
  staff_id: 'sam',
  starts_at: '07:30:00',
  ends_at: '13:00:00',
  role: 'full',
  duties: [],
  notes: null,
  proposal_id: null,
  is_draft: false,
  created_at: '',
  updated_at: '',
  ...overrides,
});

describe('shapeShifts', () => {
  it('orders shifts by date then start, names the crew, and marks the asker', () => {
    const shaped = shapeShifts(
      [
        shift({ id: 's2', shift_date: '2026-09-06', label: 'Evening', starts_at: '16:00:00', ends_at: '21:00:00' }),
        shift({ id: 's1' }),
      ],
      [
        assignment({ id: 'a2', shift_id: 's1', staff_id: 'ari', starts_at: '07:30:00', ends_at: '09:30:00', role: 'setup', duties: ['setup'] }),
        assignment({ id: 'a1', shift_id: 's1', staff_id: 'sam', duties: ['host', 'breakdown'] }),
        assignment({ id: 'a3', shift_id: 's2', staff_id: 'ari', starts_at: '16:00:00', ends_at: '21:00:00' }),
      ],
      staff,
      'sam'
    );
    expect(shaped.map((s) => s.shiftId)).toEqual(['s1', 's2']);

    const [morning, evening] = shaped;
    expect(morning).toMatchObject({
      date: '2026-09-05',
      weekday: 'Sat',
      label: 'Morning',
      startsAt: '07:30',
      endsAt: '13:00',
      staffNeeded: 2,
      openSpots: 0,
      myHours: 5.5,
    });
    expect(morning.url).toContain('/admin/schedule?view=week&date=2026-09-05');
    // Duties ride along with the crew so "who's hosting Saturday?" is answerable.
    expect(morning.crew).toEqual([
      { name: 'Ari', role: 'setup', duties: ['setup'], startsAt: '07:30', endsAt: '09:30', hours: 2, isMe: false },
      { name: 'Sam', role: 'full', duties: ['host', 'breakdown'], startsAt: '07:30', endsAt: '13:00', hours: 5.5, isMe: true },
    ]);
    expect(evening.openSpots).toBe(1);
    expect(evening.myHours).toBe(0);
  });

  it('never carries emails or other roster fields into the output', () => {
    const [shaped] = shapeShifts([shift({})], [assignment({})], staff, 'sam');
    expect(JSON.stringify(shaped)).not.toMatch(/sam@|ari@|"email"|pay_rate|calendar_token|momence/i);
  });

  it('marks nobody when the asker has no staff row', () => {
    const [shaped] = shapeShifts([shift({})], [assignment({})], staff, null);
    expect(shaped.crew.every((c) => !c.isMe)).toBe(true);
    expect(shaped.myHours).toBe(0);
  });
});

describe('myHoursByWeek', () => {
  it('totals the asker\'s active shifts by Monday week and skips cancelled ones', () => {
    const shaped = shapeShifts(
      [
        shift({ id: 's1', shift_date: '2026-08-29' }), // Sat, week of Aug 24
        shift({ id: 's2', shift_date: '2026-08-30', starts_at: '16:00:00', ends_at: '21:00:00' }), // Sun, same week
        shift({ id: 's3', shift_date: '2026-09-05' }), // Sat, week of Aug 31
        shift({ id: 's4', shift_date: '2026-09-06', status: 'cancelled' }),
      ],
      [
        assignment({ id: 'a1', shift_id: 's1' }),
        assignment({ id: 'a2', shift_id: 's2', starts_at: '16:00:00', ends_at: '21:00:00' }),
        assignment({ id: 'a3', shift_id: 's3' }),
        assignment({ id: 'a4', shift_id: 's4' }),
        assignment({ id: 'a5', shift_id: 's3', staff_id: 'ari' }),
      ],
      staff,
      'sam'
    );
    expect(myHoursByWeek(shaped)).toEqual({
      total: 16,
      byWeek: [
        { weekStart: '2026-08-24', hours: 10.5, shifts: 2 },
        { weekStart: '2026-08-31', hours: 5.5, shifts: 1 },
      ],
    });
  });
});
