// Server-side helpers for checklist runs, shared by the runs API and the
// document loader (lib/sops/document.ts) so the SOP page can embed the
// in-progress run in its first response instead of fetching it afterwards.

import type { getDb, SopRow, SopRunCheckRow, SopRunRow } from '@/lib/db';

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

type RunWithEmbeddedChecks = SopRunRow & { sop_run_checks: SopRunCheckRow[] | null };

/**
 * The newest in-progress run on `sop` with its checks, in one query (the
 * checks come embedded, sorted here by item index). Null when nobody has a
 * run open.
 */
export async function loadRunState(
  db: Db,
  sop: SopRow
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
  if (!data) return { state: null, error: null };

  const { sop_run_checks, ...run } = data as RunWithEmbeddedChecks;
  const checks = [...(sop_run_checks ?? [])].sort((a, b) => a.item_index - b.item_index);
  const { content, error: contentError } = await resolveRunContent(db, sop, run);
  if (contentError) return { state: null, error: contentError };
  return { state: { run, checks, content }, error: null };
}
