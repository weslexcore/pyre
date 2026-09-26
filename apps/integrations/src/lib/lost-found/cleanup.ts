import type { CronJobContext } from '@/lib/cron/jobs';
import { getDb } from '@/lib/db';
import { LOST_FOUND_BUCKET } from './media';

/** Retain completed items for one month (30 days) after pickup or donation. */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_PER_STATUS = 100;

export async function runLostFoundCleanup(ctx: CronJobContext) {
  const summary = { checked: 0, deleted: 0, failed: 0, dryRun: ctx.dryRun };
  const db = getDb();
  if (!db) return { ...summary, skipped: 'no-db' };

  const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
  for (const [status, dateColumn] of [
    ['picked_up', 'picked_up_at'],
    ['donated', 'donated_at'],
  ] as const) {
    const { data: items, error } = await db
      .from('lost_found_items')
      .select('id, updated_at')
      .eq('status', status)
      .lte(dateColumn, cutoff)
      .order(dateColumn, { ascending: true })
      .limit(MAX_PER_STATUS);
    if (error) throw new Error(`Lost-found cleanup read failed: ${error.message}`);

    summary.checked += items?.length ?? 0;
    if (ctx.dryRun) continue;

    for (const item of items ?? []) {
      if (ctx.timeRemainingMs() < 2_000) return summary;
      try {
        const { data: attachments, error: attachmentError } = await db
          .from('lost_found_attachments')
          .select('storage_path')
          .eq('item_id', item.id);
        if (attachmentError) throw attachmentError;

        // Recheck after loading attachments: a reopened or edited item must
        // not lose its photos based on an earlier snapshot.
        const { data: current, error: currentError } = await db
          .from('lost_found_items')
          .select('id')
          .eq('id', item.id)
          .eq('status', status)
          .eq('updated_at', item.updated_at)
          .lte(dateColumn, cutoff)
          .maybeSingle();
        if (currentError) throw currentError;
        if (!current) continue;

        // Preserve paths until Storage succeeds, so failures can be retried
        // next tick. Removing an already-removed object is safe on retry.
        if (attachments?.length) {
          const { error: storageError } = await db.storage
            .from(LOST_FOUND_BUCKET)
            .remove(attachments.map((attachment) => attachment.storage_path));
          if (storageError) throw storageError;
        }

        // Existing foreign keys cascade to attachments, notices and events.
        const { data: deleted, error: deleteError } = await db
          .from('lost_found_items')
          .delete()
          .eq('id', item.id)
          .eq('status', status)
          .eq('updated_at', item.updated_at)
          .lte(dateColumn, cutoff)
          .select('id');
        if (deleteError) throw deleteError;
        summary.deleted += deleted?.length ?? 0;
      } catch (error) {
        summary.failed += 1;
        console.error(`[lost-found] cleanup failed for ${item.id}:`, error);
      }
    }
  }
  return summary;
}
