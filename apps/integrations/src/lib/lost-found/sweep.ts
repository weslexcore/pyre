// The 30-day donation sweep.
//
// What this job does NOT do is the point of it: it never donates anything. It
// moves an item that nobody claimed in 30 days from 'unclaimed' to
// 'due_for_donation', which surfaces it on the dashboard, and stops. A person
// puts the bag in a car and drives it to Furbish, and that person marks it
// donated. An automated system quietly disposing of a guest's wedding ring
// because a cron ran is not a thing we want to be able to happen.
//
// Idempotent by construction: the query only ever matches 'unclaimed' rows
// past their deadline, so a second run in the same hour matches nothing.

import type { CronJobContext } from '@/lib/cron/jobs';
import { getDb } from '@/lib/db';
import type { LostFoundItemRow } from '@/lib/db';
import { logLostFoundEvent } from './log';

/** Bounded so one tick can't spend its whole budget here after a long outage. */
const MAX_PER_RUN = 200;

export interface SweepSummary {
  checked: number;
  flagged: number;
  dryRun: boolean;
  references: string[];
  skipped?: string;
}

export async function runLostFoundSweep(ctx: CronJobContext): Promise<SweepSummary> {
  const db = getDb();
  if (!db) return { checked: 0, flagged: 0, dryRun: ctx.dryRun, references: [], skipped: 'no-db' };

  const { data, error } = await db
    .from('lost_found_items')
    .select('*')
    .eq('status', 'unclaimed')
    .lte('donate_after', new Date().toISOString())
    .order('donate_after', { ascending: true })
    .limit(MAX_PER_RUN);

  if (error) {
    console.error('[lost-found] sweep read failed:', error.message);
    return { checked: 0, flagged: 0, dryRun: ctx.dryRun, references: [], skipped: error.message };
  }

  const due = (data ?? []) as LostFoundItemRow[];
  if (ctx.dryRun) {
    return {
      checked: due.length,
      flagged: 0,
      dryRun: true,
      references: due.map((i) => i.reference),
    };
  }

  const flagged: string[] = [];
  for (const item of due) {
    // Out of budget: the rest keep their deadline and are picked up next tick.
    if (ctx.timeRemainingMs() < 2_000) break;

    const { error: updateError } = await db
      .from('lost_found_items')
      .update({ status: 'due_for_donation', updated_at: new Date().toISOString() })
      .eq('id', item.id)
      // Guards against a staff member claiming it in the same instant.
      .eq('status', 'unclaimed');

    if (updateError) {
      console.error(`[lost-found] ${item.reference} flag failed:`, updateError.message);
      continue;
    }

    flagged.push(item.reference);
    await logLostFoundEvent(db, {
      itemId: item.id,
      action: 'donation_due',
      actor: 'cron',
      detail: { donate_after: item.donate_after, from: 'unclaimed' },
      note: 'Unclaimed for 30 days — ready for the Furbish run.',
    });
  }

  return { checked: due.length, flagged: flagged.length, dryRun: false, references: flagged };
}
