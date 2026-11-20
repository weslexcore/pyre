// Shared by the schedule specs: a `test` that gives each test calendar days
// of its own, seeds shifts on them, and cleans everything up afterwards.
//
// Every spec shares one database and one staff roster (the app caches the
// roster, so tests can't each sign in fresh staff), and the schedule's rules
// read across rows: availability is everyone's time off on a date, a claim or
// swap looks at who else works that day, the weekly roundup reads the week.
// Unique labels don't keep those apart; dates do. So each test that runs at
// the same time as another gets a different calendar week:
//
//   - Two tests run concurrently only on different workers, and a worker's
//     parallelIndex is unique among the workers running at once. A week per
//     parallelIndex can never be shared by two running tests.
//   - A side-by-side run (E2E_APP_PORT, same database) takes its own band of
//     weeks.
//   - A test reuses its week only after the previous test on that worker has
//     cleaned up, and cleanup fails the test when it can't delete. A worker
//     that crashed mid-test leaves rows behind, so the first use of a week in
//     a test clears out the suite's own leftovers in it.

import { uniqueTag } from '@pyre/e2e-utils';
import { addDays, todayEastern } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { APP_PORT } from './ports';
import { ROLES, type Role } from './roles';
import { test as base, expect } from './test';

export interface SeededShift {
  id: string;
  label: string;
  date: string;
  startsAt: string;
  endsAt: string;
  /** Assignment id per staff email. */
  assignments: Record<string, string>;
}

export interface ShiftInput {
  /**
   * Days from today (studio time). Defaults to the first day of this test's
   * own week (`days.ahead()`); pass `days.ahead(n)` or `days.past(n)` for
   * another day of it. Any other day risks sharing with a parallel test.
   */
  daysAhead?: number;
  /** Staff on the shift. */
  staff?: Role[];
  /** HH:MM; defaults to 10:00–11:00. */
  startsAt?: string;
  endsAt?: string;
}

export interface TestDays {
  /** Days from today of day `offset` (0–6) of this test's week, four or more weeks out. */
  ahead: (offset?: number) => number;
  /** Days from today of day `offset` (0–6) of this test's week in the past. */
  past: (offset?: number) => number;
}

interface ScheduleFixtures {
  /** Calendar days only this test uses while it runs. */
  days: TestDays;
  /** Seed a shift (and its assignments) for this test. Removed afterwards. */
  seedShift: (input?: ShiftInput) => Promise<SeededShift>;
  /** The staff row id for a role. */
  staffId: (role: Role) => Promise<string>;
}

/** Workers per run that get a week of their own (Playwright's parallelIndex). */
const MAX_PARALLEL = 16;
/** Side-by-side runs on other ports take the next bands of weeks. */
const RUN_BAND = (((APP_PORT - 4339) % 4) + 4) % 4;
/** The future weeks start this far out, past the board's near-term views. */
const FIRST_FUTURE_WEEK = 4;

/** Days from today to the Monday starting this week (0 on a Monday). */
function daysSinceMonday(today: string): number {
  return (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
}

function weekSlot(parallelIndex: number): number {
  if (parallelIndex >= MAX_PARALLEL) {
    throw new Error(
      `schedule-helpers gives ${MAX_PARALLEL} workers a week each; raise MAX_PARALLEL to run more`
    );
  }
  return RUN_BAND * MAX_PARALLEL + parallelIndex;
}

function testDays(parallelIndex: number): TestDays & { weeks: () => [string, string][] } {
  const today = todayEastern();
  const thisMonday = -daysSinceMonday(today);
  const slot = weekSlot(parallelIndex);
  const futureMonday = thisMonday + 7 * (FIRST_FUTURE_WEEK + slot);
  // Past weeks end before this one starts, so "past" is past on any weekday.
  const pastMonday = thisMonday - 7 * (1 + slot);
  const day = (monday: number, offset: number) => {
    if (!Number.isInteger(offset) || offset < 0 || offset > 6) {
      throw new Error(`A test's week has days 0–6, not ${offset}`);
    }
    return monday + offset;
  };
  const week = (monday: number): [string, string] => [
    addDays(today, monday),
    addDays(today, monday + 6),
  ];
  return {
    ahead: (offset = 0) => day(futureMonday, offset),
    past: (offset = 0) => day(pastMonday, offset),
    weeks: () => [week(futureMonday), week(pastMonday)],
  };
}

async function lookupStaffId(db: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await db.from('staff').select('id').eq('email', email).single();
  if (error || !data) throw new Error(`No staff row for ${email}: ${error?.message}`);
  return (data as { id: string }).id;
}

/** Fail with the database's message: cleanup that silently fails poisons later tests. */
function check(error: { message: string } | null, what: string) {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/**
 * Remove the suite's rows from a week: E2E shifts (cascading to their
 * assignments, requests, subs and swaps) and the roster's dated time off.
 */
async function clearWeek(db: SupabaseClient, [from, to]: [string, string], staffIds: string[]) {
  const shifts = await db
    .from('shifts')
    .delete()
    .like('label', 'E2E shift%')
    .gte('shift_date', from)
    .lte('shift_date', to);
  check(shifts.error, `clear leftover shifts ${from}–${to}`);
  const timeOff = await db
    .from('time_off')
    .delete()
    .in('staff_id', staffIds)
    .eq('kind', 'range')
    .lte('start_date', to)
    .gte('end_date', from);
  check(timeOff.error, `clear leftover time off ${from}–${to}`);
}

export const test = base.extend<ScheduleFixtures>({
  staffId: async ({ db }, use) => {
    const cache = new Map<string, string>();
    await use(async (role) => {
      const known = cache.get(role.email);
      if (known) return known;
      const id = await lookupStaffId(db, role.email);
      cache.set(role.email, id);
      return id;
    });
  },

  days: async ({ db, staffId }, use, testInfo) => {
    const days = testDays(testInfo.parallelIndex);
    const roster = await Promise.all(
      ROLES.filter((role) => role.storageState).map((role) => staffId(role))
    );
    for (const week of days.weeks()) await clearWeek(db, week, roster);
    await use({ ahead: days.ahead, past: days.past });
  },

  seedShift: async ({ db, staffId, days }, use, testInfo) => {
    const seeded: SeededShift[] = [];
    await use(async (input = {}) => {
      const startsAt = input.startsAt ?? '10:00';
      const endsAt = input.endsAt ?? '11:00';
      const date = addDays(todayEastern(), input.daysAhead ?? days.ahead());
      const label = uniqueTag(testInfo, 'E2E shift');
      const { data, error } = await db
        .from('shifts')
        .insert({
          shift_date: date,
          label,
          starts_at: startsAt,
          ends_at: endsAt,
          staff_needed: 2,
          // Confirmed, so it shows past the confirmed horizon too.
          confirmed_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      expect(error, 'seed shift').toBeNull();
      const id = (data as { id: string }).id;

      const assignments: Record<string, string> = {};
      for (const role of input.staff ?? []) {
        const { data: row, error: assignError } = await db
          .from('shift_assignments')
          .insert({
            shift_id: id,
            staff_id: await staffId(role),
            starts_at: startsAt,
            ends_at: endsAt,
          })
          .select('id')
          .single();
        expect(assignError, `assign ${role.email}`).toBeNull();
        assignments[role.email] = (row as { id: string }).id;
      }
      const shift = { id, label, date, startsAt, endsAt, assignments };
      seeded.push(shift);
      return shift;
    });

    // Deleting a shift cascades to its assignments, requests, subs and swap
    // offers. A sub request's time off outlives it (set null), so it goes by
    // the shift label it names. Every delete must succeed and leave nothing.
    for (const shift of seeded) {
      const timeOff = await db.from('time_off').delete().like('note', `%${shift.label}%`);
      check(timeOff.error, `remove time off for ${shift.label}`);
      const removed = await db.from('shifts').delete().eq('id', shift.id);
      check(removed.error, `remove ${shift.label}`);
      const { count, error } = await db
        .from('shift_assignments')
        .select('id', { count: 'exact', head: true })
        .eq('shift_id', shift.id);
      check(error, `count assignments left on ${shift.label}`);
      if (count) throw new Error(`${count} assignment(s) outlived ${shift.label}`);
    }
  },
});

export { expect };

/** The schedule board's week view for a date, scrolled to one shift. */
export const boardUrl = (shift: Pick<SeededShift, 'id' | 'date'>) =>
  `/admin/schedule?view=week&date=${shift.date}&shift=${shift.id}`;
