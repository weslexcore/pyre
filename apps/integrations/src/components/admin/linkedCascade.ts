// Checking an item that links to another checklist checks every item of that
// one too: the sub-checklist's bar under the item fills at once, and the
// server hears about it through the runs API's checkAll (which starts the
// sub-run if nobody has one open, and finishes it, as any full run is). The pure half — which linked checklists a
// tap reaches — is separate so it can be tested without fetch.
import { type LinkedProgress, type LinkedProgressMap, linkedSopSlugs } from '@/lib/sops/links';
import type { CheckItems } from '@/lib/sops/optimistic';
import { type RunResponse, readError } from './useSopRun';

/**
 * The linked checklists a check of `items` should complete: every one an
 * item's text links to that isn't already full. Deduped by slug.
 */
export function linkedTargets(items: CheckItems, linked: LinkedProgressMap): LinkedProgress[] {
  const out: LinkedProgress[] = [];
  for (const item of items) {
    for (const slug of linkedSopSlugs(item.itemText)) {
      const progress = linked[slug];
      if (!progress || out.some((p) => p.slug === slug)) continue;
      if (progress.status === 'completed') continue;
      if (progress.taskCount > 0 && progress.checked >= progress.taskCount) continue;
      out.push(progress);
    }
  }
  return out;
}

async function checkAll(target: LinkedProgress): Promise<LinkedProgress> {
  const res = await fetch('/api/admin/sop-runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sopId: target.sopId, checkAll: true }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as RunResponse;
  if (!body.run) return target;
  return {
    ...target,
    taskCount: body.run.task_count,
    checked: body.checks?.length ?? target.taskCount,
    status: body.run.status === 'in_progress' ? 'in_progress' : 'completed',
  };
}

/**
 * Fill the bars for the checklists `items` link to now, then have the server
 * check their items; a refused cascade puts the bar back and reports.
 */
export function cascadeLinked(
  items: CheckItems,
  linked: LinkedProgressMap,
  update: (progress: LinkedProgress) => void,
  onError: (message: string) => void
): void {
  for (const target of linkedTargets(items, linked)) {
    update({ ...target, checked: target.taskCount, status: 'completed' });
    void checkAll(target).then(update, (e: unknown) => {
      update(target);
      onError(e instanceof Error ? e.message : 'Failed to check the linked checklist');
    });
  }
}
