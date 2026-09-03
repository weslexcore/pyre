// Server-side helpers for checklist runs, shared by the runs API and the
// document loader (lib/sops/document.ts) so the SOP page can embed the
// in-progress run in its first response instead of fetching it afterwards.

import type { getDb, SopRow, SopRunCheckRow, SopRunRow } from '@/lib/db';
import { countTasks } from './checklist';
import { canViewSop, type SopAccessFields, type SopViewer } from './levels';
import { type LinkedProgressMap, linkedSopSlugs } from './links';

export type Db = NonNullable<ReturnType<typeof getDb>>;

/** The in-progress run for a document, its checks, and the content it pinned. */
export interface SopRunState {
  run: SopRunRow;
  checks: SopRunCheckRow[];
  /** The document snapshot the run started with (the current text if unchanged). */
  content: string;
}

/** Everyone one run names: who started it, ended it, and checked its items. */
export function runActors(run: SopRunRow, checks: Pick<SopRunCheckRow, 'checked_by'>[]): string[] {
  return [run.started_by, run.ended_by ?? '', ...checks.map((c) => c.checked_by)];
}

/**
 * Ids of the documents this viewer may read. The run log is scoped by this
 * rather than by who took part: a run's checks quote the document's items, so
 * run visibility follows document visibility and nothing else. Admins are not
 * narrowed at all — canViewSop already passes everything for them, archived
 * documents included — so callers may skip this for an admin.
 */
export function visibleSopIds(
  viewer: SopViewer,
  sops: (SopAccessFields & { id: string })[]
): string[] {
  return sops.filter((sop) => canViewSop(viewer, sop)).map((sop) => sop.id);
}

/**
 * The ids the run log narrows on for a non-admin, read from the library. Pass
 * `onlySopId` when the caller already names one document (the SOP page's Runs
 * panel) so this checks that row alone. Only the grant columns are selected —
 * the named-email grants stay server-side, as they do everywhere else.
 */
export async function loadViewableSopIds(
  db: Db,
  viewer: SopViewer,
  onlySopId?: string | null
): Promise<{ ids: string[]; error: string | null }> {
  let query = db
    .from('sops')
    .select('id, view_roles, edit_roles, view_emails, edit_emails, archived');
  if (onlySopId) query = query.eq('id', onlySopId);
  const { data, error } = await query;
  if (error) return { ids: [], error: error.message };
  return {
    ids: visibleSopIds(viewer, (data ?? []) as (SopAccessFields & { id: string })[]),
    error: null,
  };
}

export async function loadRunChecks(db: Db, runId: string) {
  return db
    .from('sop_run_checks')
    .select('*')
    .eq('run_id', runId)
    .order('item_index', { ascending: true });
}

/** The run's document snapshot (title + content of the pinned version). */
export async function loadRunContent(db: Db, run: SopRunRow) {
  const { data, error } = await db
    .from('sop_versions')
    .select('title, content_md')
    .eq('sop_id', run.sop_id)
    .eq('version', run.sop_version)
    .maybeSingle();
  return { snapshot: (data as { title: string; content_md: string } | null) ?? null, error };
}

/**
 * The content a run renders against: the document's current text when the run
 * pinned the current version (the common case, no query), otherwise the
 * snapshot of the version it started with.
 */
export async function resolveRunContent(
  db: Db,
  sop: SopRow,
  run: SopRunRow
): Promise<{ content: string; error: string | null }> {
  if (run.sop_version === sop.current_version) return { content: sop.content_md, error: null };
  const { snapshot, error } = await loadRunContent(db, run);
  if (error) return { content: sop.content_md, error: error.message };
  return { content: snapshot?.content_md ?? sop.content_md, error: null };
}

/** One unfinished run as the library strip and the admin home show it. */
export interface ActiveRun {
  id: string;
  sop_id: string;
  task_count: number;
  checked_count: number;
  started_by: string;
  started_at: string;
  title: string;
  slug: string;
}

type ActiveRunRow = SopRunRow & {
  sops: SopRow | null;
  sop_run_checks: { item_index: number }[] | null;
};

/**
 * Every unfinished run on a document this viewer may read, newest first.
 * Runs are shared per document — whoever walks up next continues the open
 * one — so this is deliberately not scoped to the caller's own runs; callers
 * mark those with sameActor() instead. Feeds the "in progress" strip on the
 * library page and the same block on the admin home.
 */
export async function loadActiveRuns(
  db: Db,
  viewer: SopViewer,
  limit = 100
): Promise<{ runs: ActiveRun[]; error: string | null }> {
  const { data, error } = await db
    .from('sop_runs')
    .select('*, sops(*), sop_run_checks(item_index)')
    .eq('status', 'in_progress')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) return { runs: [], error: error.message };
  const runs = ((data ?? []) as ActiveRunRow[]).flatMap((row) => {
    const sop = row.sops;
    if (!sop || !canViewSop(viewer, sop)) return [];
    return [
      {
        id: row.id,
        sop_id: row.sop_id,
        task_count: row.task_count,
        checked_count: row.sop_run_checks?.length ?? 0,
        started_by: row.started_by,
        started_at: row.started_at,
        title: sop.title,
        slug: sop.slug,
      },
    ];
  });
  return { runs, error: null };
}

type RunWithEmbeddedChecks = SopRunRow & { sop_run_checks: SopRunCheckRow[] | null };

/**
 * The newest in-progress run on `sop` with its checks, in one query (the
 * checks come embedded, sorted here by item index). Null when nobody has a
 * run open — unless `since` is given, in which case the newest run completed
 * at or after that moment stands in, so a sub-checklist opened from a parent
 * run still shows the ticks that finished it during this run of the parent.
 */
export async function loadRunState(
  db: Db,
  sop: SopRow,
  opts: { since?: string | null } = {}
): Promise<{ state: SopRunState | null; error: string | null }> {
  const { data, error } = await db
    .from('sop_runs')
    .select('*, sop_run_checks(*)')
    .eq('sop_id', sop.id)
    .eq('status', 'in_progress')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { state: null, error: error.message };
  let row = data as RunWithEmbeddedChecks | null;
  if (!row && opts.since) {
    const finished = await db
      .from('sop_runs')
      .select('*, sop_run_checks(*)')
      .eq('sop_id', sop.id)
      .eq('status', 'completed')
      .gte('ended_at', opts.since)
      .order('ended_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (finished.error) return { state: null, error: finished.error.message };
    row = finished.data as RunWithEmbeddedChecks | null;
  }
  if (!row) return { state: null, error: null };

  const { sop_run_checks, ...run } = row;
  const checks = [...(sop_run_checks ?? [])].sort((a, b) => a.item_index - b.item_index);
  const { content, error: contentError } = await resolveRunContent(db, sop, run);
  if (contentError) return { state: null, error: contentError };
  return { state: { run, checks, content }, error: null };
}

/**
 * Finish a run the moment its last item is checked: nobody should have to
 * tap Finish after ticking everything (Finish is for leaving items undone).
 * Returns the run as it now stands — finished, or unchanged when items
 * remain or a teammate finished it first.
 */
export async function completeIfFull(
  db: Db,
  run: SopRunRow,
  checks: Pick<SopRunCheckRow, 'item_index'>[],
  email: string
): Promise<{ run: SopRunRow; error: string | null }> {
  if (run.status !== 'in_progress' || checks.length < run.task_count) {
    return { run, error: null };
  }
  const { data, error } = await db
    .from('sop_runs')
    .update({ status: 'completed', ended_by: email, ended_at: new Date().toISOString() })
    .eq('id', run.id)
    .eq('status', 'in_progress')
    .select('*')
    .maybeSingle();
  if (error) return { run, error: error.message };
  return { run: (data as SopRunRow | null) ?? run, error: null };
}

type LinkedRunRow = Pick<SopRunRow, 'sop_id' | 'task_count'> & {
  sop_run_checks: { item_index: number }[] | null;
};

/**
 * Progress of every task-bearing document `sop` links to, for the bars under
 * the parent's items. An open run shows its count; a run completed since the
 * parent's own run started counts as done (so "Completed" means this shift,
 * not ever); anything else is not started. Documents the viewer can't read,
 * archived ones, and prose-only pages get no entry — and no bar.
 */
export async function loadLinkedProgress(
  db: Db,
  viewer: SopViewer,
  sop: SopRow,
  parentRun: SopRunRow | null
): Promise<{ linked: LinkedProgressMap; error: string | null }> {
  const slugs = linkedSopSlugs(sop.content_md);
  if (slugs.length === 0) return { linked: {}, error: null };

  const { data: rows, error } = await db.from('sops').select('*').in('slug', slugs);
  if (error) return { linked: {}, error: error.message };
  const targets = ((rows ?? []) as SopRow[]).filter(
    (row) => canViewSop(viewer, row) && !row.archived && countTasks(row.content_md) > 0
  );
  if (targets.length === 0) return { linked: {}, error: null };
  const ids = targets.map((row) => row.id);

  const [open, completed] = await Promise.all([
    db
      .from('sop_runs')
      .select('sop_id, task_count, sop_run_checks(item_index)')
      .in('sop_id', ids)
      .eq('status', 'in_progress')
      .order('started_at', { ascending: false }),
    parentRun
      ? db
          .from('sop_runs')
          .select('sop_id')
          .in('sop_id', ids)
          .eq('status', 'completed')
          .gte('ended_at', parentRun.started_at)
      : Promise.resolve({ data: [] as { sop_id: string }[], error: null }),
  ]);
  if (open.error) return { linked: {}, error: open.error.message };
  if (completed.error) return { linked: {}, error: completed.error.message };

  // Newest open run per document (the query is newest-first).
  const openBySop = new Map<string, LinkedRunRow>();
  for (const row of (open.data ?? []) as LinkedRunRow[]) {
    if (!openBySop.has(row.sop_id)) openBySop.set(row.sop_id, row);
  }
  const completedSops = new Set(
    ((completed.data ?? []) as { sop_id: string }[]).map((r) => r.sop_id)
  );

  const linked: LinkedProgressMap = {};
  for (const target of targets) {
    const taskCount = countTasks(target.content_md);
    const run = openBySop.get(target.id);
    if (run) {
      linked[target.slug] = {
        slug: target.slug,
        sopId: target.id,
        taskCount: run.task_count,
        checked: run.sop_run_checks?.length ?? 0,
        status: 'in_progress',
      };
    } else if (completedSops.has(target.id)) {
      linked[target.slug] = {
        slug: target.slug,
        sopId: target.id,
        taskCount,
        checked: taskCount,
        status: 'completed',
      };
    } else {
      linked[target.slug] = {
        slug: target.slug,
        sopId: target.id,
        taskCount,
        checked: 0,
        status: 'none',
      };
    }
  }
  return { linked, error: null };
}
