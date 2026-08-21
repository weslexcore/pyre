// Checklist-run API for the SOP library. A run is one execution of a
// task-bearing SOP: POST starts (or resumes the in-progress run of) one, PATCH
// checks/unchecks items and completes or abandons the run, GET fetches a
// single run (?id=), the in-progress run for a document (?sopId=), or the run
// log (?view=list — admins see all runs, others their own), DELETE (admin
// only) removes a run and its check records outright.
//
// Permissions follow the document: anyone who may view an SOP may run it and
// check items (running a checklist is the staff-level act the tool exists
// for); identities are always taken from the session. Runs pin the document
// version current at start, so item indexes stay meaningful if the document
// is edited mid-run. Mutations are CSRF-guarded in-route like the rest
// (global checkOrigin stays off; see astro.config.mjs).

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin, requirePage } from '@/lib/auth/admin';
import { getDb, type SopRow, type SopRunCheckRow, type SopRunRow } from '@/lib/db';
import { countTasks } from '@/lib/sops/checklist';
import { canViewSop } from '@/lib/sops/levels';
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
    if (!sop || !canViewSop(role, sop)) return json({ error: 'SOP not found' }, 404);

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
  if (!sop || !canViewSop(role, sop)) return json({ error: 'Run not found' }, 404);

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

  const { data: sopData, error: sopError } = await db
    .from('sops')
    .select('*')
    .eq('id', sopId)
    .maybeSingle();
  if (sopError) return json({ error: sopError.message }, 500);
  const sop = (sopData as SopRow) ?? null;

  const role = await getSopRole(gate.user.email ?? null, gate.access);
  if (!sop || !canViewSop(role, sop)) return json({ error: 'SOP not found' }, 404);
  if (sop.archived) return json({ error: 'This SOP is archived' }, 400);

  const taskCount = countTasks(sop.content_md);
  if (taskCount === 0) return json({ error: 'This SOP has no checklist items' }, 400);

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
  return json(
    {
      run: newRun,
      checks: [],
      content: sop.content_md,
      resumed: false,
      people: await getPeopleNames(runActors(newRun, [])),
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
  if (typeof action !== 'string' || !['check', 'uncheck', 'complete', 'abandon'].includes(action)) {
    return json({ error: 'action must be check, uncheck, complete, or abandon' }, 400);
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
  if (!sop || !canViewSop(role, sop)) return json({ error: 'Run not found' }, 404);
  if (run.status !== 'in_progress') {
    return json({ error: 'This run is already finished' }, 409);
  }

  const email = gate.user.email ?? '';

  if (action === 'check') {
    const itemIndex = body.itemIndex;
    if (
      typeof itemIndex !== 'number' ||
      !Number.isInteger(itemIndex) ||
      itemIndex < 0 ||
      itemIndex >= run.task_count
    ) {
      return json({ error: `itemIndex must be an integer in [0, ${run.task_count})` }, 400);
    }
    const itemText =
      typeof body.itemText === 'string' && body.itemText.trim()
        ? body.itemText.trim().slice(0, MAX_ITEM_TEXT)
        : `Item ${itemIndex + 1}`;

    // The (run_id, item_index) unique constraint makes a double-check from two
    // devices a no-op instead of an error.
    const { error } = await db
      .from('sop_run_checks')
      .upsert(
        { run_id: runId, item_index: itemIndex, item_text: itemText, checked_by: email },
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
  } else {
    // complete / abandon
    const { error } = await db
      .from('sop_runs')
      .update({
        status: action === 'complete' ? 'completed' : 'abandoned',
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
