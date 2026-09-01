// Checklist-run API for the SOP library. A run is one execution of a
// task-bearing SOP: POST starts (or joins the in-progress run of) one —
// optionally recording a first check in the same request, since the UI starts
// a run implicitly when the first box is tapped — PATCH checks/unchecks items,
// completes the run, or discards it, GET fetches a single run (?id=), the
// in-progress run for a document (?sopId=), every unfinished run the caller
// may view (?view=active — the library's in-progress strip), or the run log
// (?view=list — admins see all runs, others their own), DELETE (admin only)
// removes a run and its check records outright.
//
// Runs end implicitly too: an uncheck that leaves zero items checked deletes
// the run outright (same effect as discard), so a stray first tap that gets
// untapped never litters the log.
//
// A run stays in progress until someone completes it — there is no stepping
// out of one to come back later. Discard is the escape hatch for a checklist
// started by mistake: it deletes the run and its checks instead of logging
// them, so the record only ever holds work that actually happened. (Runs from
// before discard replaced it may still carry the 'abandoned' status; the log
// still renders those.)
//
// Permissions follow the document: anyone who may view an SOP may run it,
// check items, and discard the open run (runs are shared per document, so
// whoever is standing there owns the mistake); identities are always taken
// from the session. Runs pin the document version current at start, so item
// indexes stay meaningful if the document is edited mid-run. Mutations are
// CSRF-guarded in-route like the rest (global checkOrigin stays off; see
// astro.config.mjs).

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin, requirePage } from '@/lib/auth/admin';
import { getDb, type SopRow, type SopRunCheckRow, type SopRunRow } from '@/lib/db';
import { countTasks } from '@/lib/sops/checklist';
import { canViewSop, normalizeEmail, type SopViewer } from '@/lib/sops/levels';
import { getPeopleNames } from '@/lib/sops/people';
import { getSopRole } from '@/lib/sops/role';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const PAGE = '/admin/sops';
const MAX_ITEM_TEXT = 500;
const LIST_LIMIT = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = NonNullable<ReturnType<typeof getDb>>;

interface CheckItem {
  itemIndex: number;
  itemText: string;
}

/**
 * A list of checks from a request body, deduped by index — or an error string.
 * Checking a parent task checks its whole subtree, so both the start request
 * and the check action carry lists rather than single items.
 */
function parseCheckItems(
  value: unknown
): { items: CheckItem[]; error?: never } | { error: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { error: 'items must be a non-empty array of { itemIndex, itemText }' };
  }
  const byIndex = new Map<number, CheckItem>();
  for (const entry of value) {
    const raw = entry as Record<string, unknown> | null;
    const itemIndex = raw && typeof raw === 'object' ? raw.itemIndex : undefined;
    if (typeof itemIndex !== 'number' || !Number.isInteger(itemIndex) || itemIndex < 0) {
      return { error: 'itemIndex must be a non-negative integer' };
    }
    const itemText =
      typeof raw?.itemText === 'string' && raw.itemText.trim()
        ? raw.itemText.trim().slice(0, MAX_ITEM_TEXT)
        : `Item ${itemIndex + 1}`;
    byIndex.set(itemIndex, { itemIndex, itemText });
  }
  return { items: [...byIndex.values()] };
}

/** A run joined to its document and its check rows (?view=active). */
type ActiveRunRow = SopRunRow & {
  sops: SopRow | null;
  sop_run_checks: { item_index: number }[];
};

/** A run row as the log query returns it, with its checks embedded. */
type RunWithChecks = SopRunRow & { sop_run_checks: Pick<SopRunCheckRow, 'checked_by'>[] };

/** Everyone one run names: who started it, ended it, and checked its items. */
function runActors(run: SopRunRow, checks: Pick<SopRunCheckRow, 'checked_by'>[]): string[] {
  return [run.started_by, run.ended_by ?? '', ...checks.map((c) => c.checked_by)];
}

async function loadRunChecks(db: Db, runId: string) {
  return db
    .from('sop_run_checks')
    .select('*')
    .eq('run_id', runId)
    .order('item_index', { ascending: true });
}

/** The run's document snapshot (title + content of the pinned version). */
async function loadRunContent(db: Db, run: SopRunRow) {
  const { data, error } = await db
    .from('sop_versions')
    .select('title, content_md')
    .eq('sop_id', run.sop_id)
    .eq('version', run.sop_version)
    .maybeSingle();
  return { snapshot: (data as { title: string; content_md: string } | null) ?? null, error };
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const role = await getSopRole(gate.user.email ?? null, gate.access);
  const viewer: SopViewer = { role, email: normalizeEmail(gate.user.email) };

  // Every unfinished run on a document this role may view, newest first. Runs
  // are shared per document — whoever walks up next continues the open one —
  // so this is deliberately not scoped to the caller's own runs the way the
  // log below is. Feeds the "in progress" strip at the top of the library.
  if (url.searchParams.get('view') === 'active') {
    const { data, error } = await db
      .from('sop_runs')
      .select('*, sops(*), sop_run_checks(item_index)')
      .eq('status', 'in_progress')
      .order('started_at', { ascending: false })
      .limit(LIST_LIMIT);
    if (error) return json({ error: error.message }, 500);

    const rows = (data ?? []) as ActiveRunRow[];
    const runs = rows.flatMap((row) => {
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

    return json({
      // Names for whoever started these runs, so the strip reads as people.
      runs,
      people: await getPeopleNames(runs.map((run) => run.started_by)),
    });
  }

  // Run log, newest first, with sop identity and the full per-item check
  // record embedded. Admins see every run; everyone else sees the runs they
  // took part in — started, ended, or checked at least one item. ?sopId=
  // narrows to one document (the SOP page's Runs panel).
  if (url.searchParams.get('view') === 'list') {
    const listSopId = url.searchParams.get('sopId');
    if (listSopId && !UUID_RE.test(listSopId)) {
      return json({ error: 'sopId must be a UUID' }, 400);
    }

    const status = url.searchParams.get('status');
    let query = db
      .from('sop_runs')
      .select(
        '*, sops(title, slug, category), sop_run_checks(item_index, item_text, checked_by, checked_at)'
      )
      .order('started_at', { ascending: false })
      .limit(LIST_LIMIT);
    if (listSopId) query = query.eq('sop_id', listSopId);
    if (status) {
      // 'abandoned' only matches runs from before discard replaced it.
      if (!['in_progress', 'completed', 'abandoned'].includes(status)) {
        return json({ error: 'status must be in_progress, completed, or abandoned' }, 400);
      }
      query = query.eq('status', status);
    }

    if (!gate.access.isAdmin) {
      const email = (gate.user.email ?? '').toLowerCase();
      if (!email) return json({ runs: [], scope: 'mine' });
      // Participation = started/ended the run, or checked an item in it (runs
      // are shared, so a helper's checks make it their run too).
      const { data: checkRows, error: checkError } = await db
        .from('sop_run_checks')
        .select('run_id')
        .eq('checked_by', email)
        .limit(500);
      if (checkError) return json({ error: checkError.message }, 500);
      const participatedIds = [...new Set((checkRows ?? []).map((r) => r.run_id as string))];
      const orParts = [`started_by.eq."${email}"`, `ended_by.eq."${email}"`];
      if (participatedIds.length > 0) orParts.push(`id.in.(${participatedIds.join(',')})`);
      query = query.or(orParts.join(','));
    }

    const { data, error } = await query;
    if (error) return json({ error: error.message }, 500);
    const runRows = (data ?? []) as RunWithChecks[];
    return json({
      runs: runRows,
      scope: gate.access.isAdmin ? 'all' : 'mine',
      // Names for everyone these runs name — started, ended, or checked an
      // item — so the log reads as people rather than mailbox local parts.
      people: await getPeopleNames(
        runRows.flatMap((run) => runActors(run, run.sop_run_checks ?? []))
      ),
    });
  }

  // In-progress run for one document (the doc page's "Resume" lookup).
  const sopId = url.searchParams.get('sopId');
  if (sopId) {
    if (!UUID_RE.test(sopId)) return json({ error: 'sopId must be a UUID' }, 400);

    const { data: sopData, error: sopError } = await db
      .from('sops')
      .select('*')
      .eq('id', sopId)
      .maybeSingle();
    if (sopError) return json({ error: sopError.message }, 500);
    const sop = (sopData as SopRow) ?? null;
    if (!sop || !canViewSop(viewer, sop)) return json({ error: 'SOP not found' }, 404);

    const { data: runData, error: runError } = await db
      .from('sop_runs')
      .select('*')
      .eq('sop_id', sopId)
      .eq('status', 'in_progress')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (runError) return json({ error: runError.message }, 500);
    const run = (runData as SopRunRow) ?? null;
    if (!run) return json({ run: null });

    const { data: checks, error: checksError } = await loadRunChecks(db, run.id);
    if (checksError) return json({ error: checksError.message }, 500);
    const { snapshot, error: snapshotError } = await loadRunContent(db, run);
    if (snapshotError) return json({ error: snapshotError.message }, 500);

    const runChecks = (checks ?? []) as SopRunCheckRow[];
    return json({
      run,
      checks: runChecks,
      content: snapshot?.content_md ?? sop.content_md,
      people: await getPeopleNames(runActors(run, runChecks)),
    });
  }

  // Single run by id.
  const id = url.searchParams.get('id');
  if (!id || !UUID_RE.test(id)) return json({ error: 'id (UUID) or sopId is required' }, 400);

  const { data: runData, error: runError } = await db
    .from('sop_runs')
    .select('*, sops(*)')
    .eq('id', id)
    .maybeSingle();
  if (runError) return json({ error: runError.message }, 500);
  if (!runData) return json({ error: 'Run not found' }, 404);
  const { sops: sop, ...run } = runData as SopRunRow & { sops: SopRow };
  if (!sop || !canViewSop(viewer, sop)) return json({ error: 'Run not found' }, 404);

  const { data: checks, error: checksError } = await loadRunChecks(db, run.id);
  if (checksError) return json({ error: checksError.message }, 500);
  const { snapshot, error: snapshotError } = await loadRunContent(db, run as SopRunRow);
  if (snapshotError) return json({ error: snapshotError.message }, 500);

  const runChecks = (checks ?? []) as SopRunCheckRow[];
  return json({
    run,
    checks: runChecks,
    content: snapshot?.content_md ?? sop.content_md,
    sop: { id: sop.id, slug: sop.slug, title: sop.title },
    people: await getPeopleNames(runActors(run as SopRunRow, runChecks)),
  });
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const sopId = typeof body.sopId === 'string' ? body.sopId : '';
  if (!UUID_RE.test(sopId)) return json({ error: 'sopId must be a UUID' }, 400);

  // Optional first checks, recorded in the same request as the start so the
  // UI's tap-to-start needs no second round trip (and no window where a run
  // exists with nothing checked). A list because tapping a parent task checks
  // its whole subtree in one go.
  let initialChecks: CheckItem[] | null = null;
  if (body.initialChecks !== undefined) {
    const parsed = parseCheckItems(body.initialChecks);
    if (parsed.error) return json({ error: `initialChecks: ${parsed.error}` }, 400);
    initialChecks = parsed.items;
  }

  const { data: sopData, error: sopError } = await db
    .from('sops')
    .select('*')
    .eq('id', sopId)
    .maybeSingle();
  if (sopError) return json({ error: sopError.message }, 500);
  const sop = (sopData as SopRow) ?? null;

  const role = await getSopRole(gate.user.email ?? null, gate.access);
  const viewer: SopViewer = { role, email: normalizeEmail(gate.user.email) };
  if (!sop || !canViewSop(viewer, sop)) return json({ error: 'SOP not found' }, 404);
  if (sop.archived) return json({ error: 'This SOP is archived' }, 400);

  const taskCount = countTasks(sop.content_md);
  if (taskCount === 0) return json({ error: 'This SOP has no checklist items' }, 400);
  if (initialChecks?.some((item) => item.itemIndex >= taskCount)) {
    return json({ error: `initialChecks indexes must be in [0, ${taskCount})` }, 400);
  }

  // One in-progress run per document: starting while one is open resumes it
  // (two people splitting a checklist share the run — that's the point).
  const { data: existing, error: existingError } = await db
    .from('sop_runs')
    .select('*')
    .eq('sop_id', sopId)
    .eq('status', 'in_progress')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) return json({ error: existingError.message }, 500);

  if (existing) {
    const run = existing as SopRunRow;
    // The tap that meant "start" joins the run someone else already opened.
    // Indexes are validated against that run's (possibly older) snapshot — a
    // tap past its task list is dropped rather than misfiled.
    const joinable = (initialChecks ?? []).filter((item) => item.itemIndex < run.task_count);
    if (joinable.length > 0) {
      const { error: checkError } = await db.from('sop_run_checks').upsert(
        joinable.map((item) => ({
          run_id: run.id,
          item_index: item.itemIndex,
          item_text: item.itemText,
          checked_by: gate.user.email ?? '',
        })),
        { onConflict: 'run_id,item_index', ignoreDuplicates: true }
      );
      if (checkError) return json({ error: checkError.message }, 500);
    }
    const { data: checks, error: checksError } = await loadRunChecks(db, run.id);
    if (checksError) return json({ error: checksError.message }, 500);
    const { snapshot } = await loadRunContent(db, run);
    const runChecks = (checks ?? []) as SopRunCheckRow[];
    return json({
      run,
      checks: runChecks,
      content: snapshot?.content_md ?? sop.content_md,
      resumed: true,
      people: await getPeopleNames(runActors(run, runChecks)),
    });
  }

  const { data: created, error: createError } = await db
    .from('sop_runs')
    .insert({
      sop_id: sopId,
      sop_version: sop.current_version,
      task_count: taskCount,
      started_by: gate.user.email ?? '',
    })
    .select('*')
    .single();
  if (createError) return json({ error: createError.message }, 500);

  const newRun = created as SopRunRow;
  let newChecks: SopRunCheckRow[] = [];
  if (initialChecks) {
    // No transaction over PostgREST: if this insert fails, best-effort delete
    // the just-created run so the failed tap doesn't leave an empty run
    // behind. (A crash between the two statements can — the uncheck
    // auto-discard and explicit Discard both clean that up.)
    const { data: checkRows, error: checkError } = await db
      .from('sop_run_checks')
      .insert(
        initialChecks.map((item) => ({
          run_id: newRun.id,
          item_index: item.itemIndex,
          item_text: item.itemText,
          checked_by: gate.user.email ?? '',
        }))
      )
      .select('*');
    if (checkError) {
      await db.from('sop_runs').delete().eq('id', newRun.id);
      return json({ error: checkError.message }, 500);
    }
    newChecks = (checkRows ?? []) as SopRunCheckRow[];
  }
  return json(
    {
      run: newRun,
      checks: newChecks,
      content: sop.content_md,
      resumed: false,
      people: await getPeopleNames(runActors(newRun, newChecks)),
    },
    201
  );
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const runId = typeof body.runId === 'string' ? body.runId : '';
  if (!UUID_RE.test(runId)) return json({ error: 'runId must be a UUID' }, 400);

  const action = body.action;
  if (typeof action !== 'string' || !['check', 'uncheck', 'complete', 'discard'].includes(action)) {
    return json({ error: 'action must be check, uncheck, complete, or discard' }, 400);
  }

  const { data: runData, error: runError } = await db
    .from('sop_runs')
    .select('*, sops(*)')
    .eq('id', runId)
    .maybeSingle();
  if (runError) return json({ error: runError.message }, 500);
  if (!runData) return json({ error: 'Run not found' }, 404);
  const { sops: sop, ...run } = runData as SopRunRow & { sops: SopRow };

  const role = await getSopRole(gate.user.email ?? null, gate.access);
  const viewer: SopViewer = { role, email: normalizeEmail(gate.user.email) };
  if (!sop || !canViewSop(viewer, sop)) return json({ error: 'Run not found' }, 404);
  if (run.status !== 'in_progress') {
    return json({ error: 'This run is already finished' }, 409);
  }

  const email = gate.user.email ?? '';

  if (action === 'check') {
    // One or many items — tapping a parent task checks its whole subtree.
    // A bare { itemIndex, itemText } is accepted as shorthand for one item.
    const parsed = parseCheckItems(
      body.items !== undefined
        ? body.items
        : [{ itemIndex: body.itemIndex, itemText: body.itemText }]
    );
    if (parsed.error) return json({ error: parsed.error }, 400);
    if (parsed.items.some((item) => item.itemIndex >= run.task_count)) {
      return json({ error: `itemIndex must be an integer in [0, ${run.task_count})` }, 400);
    }

    // The (run_id, item_index) unique constraint makes a double-check from two
    // devices a no-op instead of an error.
    const { error } = await db.from('sop_run_checks').upsert(
      parsed.items.map((item) => ({
        run_id: runId,
        item_index: item.itemIndex,
        item_text: item.itemText,
        checked_by: email,
      })),
      { onConflict: 'run_id,item_index', ignoreDuplicates: true }
    );
    if (error) return json({ error: error.message }, 500);
  } else if (action === 'uncheck') {
    const itemIndex = body.itemIndex;
    if (typeof itemIndex !== 'number' || !Number.isInteger(itemIndex) || itemIndex < 0) {
      return json({ error: 'itemIndex must be a non-negative integer' }, 400);
    }
    const { error } = await db
      .from('sop_run_checks')
      .delete()
      .eq('run_id', runId)
      .eq('item_index', itemIndex);
    if (error) return json({ error: error.message }, 500);

    // Runs start implicitly with the first check, so they end implicitly when
    // the last one goes: nothing checked means nothing happened, and the run
    // vanishes like a discard. Race note: if a teammate's check lands between
    // the delete above and this count, the count is non-zero and the run
    // survives (correct); if their check is in flight when the run row goes,
    // that insert fails on the FK and their client retries as a fresh start.
    const { count, error: countError } = await db
      .from('sop_run_checks')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', runId);
    if (countError) return json({ error: countError.message }, 500);
    if ((count ?? 0) === 0) {
      const { error: discardError } = await db
        .from('sop_runs')
        .delete()
        .eq('id', runId)
        .eq('status', 'in_progress');
      if (discardError) return json({ error: discardError.message }, 500);
      return json({ run: null, checks: [], discarded: true });
    }
  } else if (action === 'discard') {
    // Started by mistake: erase the run and its checks (they cascade) so
    // nothing lands in the log. Only reachable while in progress — the status
    // guard above already rejected finished runs.
    const { error } = await db
      .from('sop_runs')
      .delete()
      .eq('id', runId)
      .eq('status', 'in_progress');
    if (error) return json({ error: error.message }, 500);
    return json({ run: null, checks: [], discarded: true });
  } else {
    // complete
    const { error } = await db
      .from('sop_runs')
      .update({
        status: 'completed',
        ended_by: email,
        ended_at: new Date().toISOString(),
      })
      .eq('id', runId)
      .eq('status', 'in_progress');
    if (error) return json({ error: error.message }, 500);
  }

  const { data: checks, error: checksError } = await loadRunChecks(db, runId);
  if (checksError) return json({ error: checksError.message }, 500);

  const { data: freshRun, error: freshError } = await db
    .from('sop_runs')
    .select('*')
    .eq('id', runId)
    .single();
  if (freshError) return json({ error: freshError.message }, 500);

  const freshChecks = (checks ?? []) as SopRunCheckRow[];
  return json({
    run: freshRun as SopRunRow,
    checks: freshChecks,
    people: await getPeopleNames(runActors(freshRun as SopRunRow, freshChecks)),
  });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  // Removing a run erases its accountability record (checks cascade with it),
  // so this is admin-only — used to clean up test runs and mistakes.
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id || !UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);

  const { data, error } = await db
    .from('sop_runs')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: 'Run not found' }, 404);

  return json({ ok: true });
};
