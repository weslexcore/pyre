// Shared by the schedule specs: a `test` that can seed shifts for a test and clean them up afterwards.
//
// Every spec shares one database with the other specs and device projects,
// and the schedule's rules read across rows (availability is everyone's time
// off on a date). So each shift gets a label unique to its test and a random
// window of the day, and everything a test seeds (shifts, and the time off
// a sub request logs) is removed when it ends.

import { uniqueTag } from '@pyre/e2e-utils';
import { addDays, todayEastern } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from './roles';
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
  /** Days from today (studio time). Defaults to a random day 2–6 ahead. */
  daysAhead?: number;
  /** Staff on the shift. */
  staff?: Role[];
  /** HH:MM; defaults to a random hour-long window. */
  startsAt?: string;
  endsAt?: string;
}

interface ScheduleFixtures {
  /** Seed a shift (and its assignments) for this test. Removed afterwards. */
  seedShift: (input?: ShiftInput) => Promise<SeededShift>;
  /** The staff row id for a role. */
  staffId: (role: Role) => Promise<string>;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A random hour-long window between 06:00 and 21:59, so tests rarely overlap. */
function randomWindow(): { startsAt: string; endsAt: string } {
  const startMinutes = 6 * 60 + Math.floor(Math.random() * (15 * 60));
  const endMinutes = startMinutes + 60;
  const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  return { startsAt: hhmm(startMinutes), endsAt: hhmm(endMinutes) };
}

async function lookupStaffId(db: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await db.from('staff').select('id').eq('email', email).single();
  if (error || !data) throw new Error(`No staff row for ${email}: ${error?.message}`);
  return (data as { id: string }).id;
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

  seedShift: async ({ db, staffId }, use, testInfo) => {
    const seeded: SeededShift[] = [];
    await use(async (input = {}) => {
      const window = input.startsAt && input.endsAt ? input : randomWindow();
      const startsAt = window.startsAt as string;
      const endsAt = window.endsAt as string;
      const date = addDays(todayEastern(), input.daysAhead ?? 2 + Math.floor(Math.random() * 5));
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
    // the shift label it names.
    for (const shift of seeded) {
      await db.from('time_off').delete().like('note', `%${shift.label}%`);
      await db.from('shifts').delete().eq('id', shift.id);
    }
  },
});

export { expect };

/** The schedule board's week view for a date, scrolled to one shift. */
export const boardUrl = (shift: Pick<SeededShift, 'id' | 'date'>) =>
  `/admin/schedule?view=week&date=${shift.date}&shift=${shift.id}`;
