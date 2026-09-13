// Checklist-run API for the SOP library. A run is one execution of a
// task-bearing SOP: POST starts (or joins the in-progress run of) one —
// optionally recording a first check in the same request, since the UI starts
// a run implicitly when the first box is tapped, or checking every item at
// once (checkAll — a parent checklist ticking off the item that links here) —
// PATCH resolves/un-resolves items or discards the run, GET fetches a single
// run (?id=), the in-progress run for a document (?sopId=), every unfinished
// run the caller may view (?view=active — the library's in-progress strip),
// or the run log (?view=list — every run of the SOPs the caller may view),
// DELETE (admin only) removes a run and its check records outright.
//
// Every item is resolved one of two ways: completed, or explicitly skipped
// (a check item with skipped: true). Both write a sop_run_checks row naming
// who and when; the row's `skipped` flag tells them apart, so the record
// never leaves anyone wondering whether an item was passed over on purpose
// or simply never looked at. Items the document marks required (`- [!]`)
// may only be completed: a skip of one is refused here, against the version
// the run pinned, so the UI hiding Skip on those rows is a convenience and
// this is the rule. There is no finishing a run by hand: it
// completes itself the moment its last item is resolved (completeIfFull),
// and an uncheck that leaves zero items resolved deletes the run outright
// (same effect as discard), so a stray first tap that gets untapped never
// litters the log.
//
// A run stays in progress until every item is resolved — there is no
// stepping out of one to come back later. Discard is the escape hatch for a
// checklist started by mistake: it deletes the run and its checks instead of
// logging them, so the record only ever holds work that actually happened.
// (Runs from before this: 'abandoned' ones from before discard replaced it,
// and completed ones ended short by the old Finish action, still render in
// the log — their missing items read as never checked.)
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
import { countTasks, forbiddenSkips, parseChecklist } from '@/lib/sops/checklist';
import { canViewSop, normalizeEmail, type SopViewer } from '@/lib/sops/levels';
import { getPeopleNames } from '@/lib/sops/people';
import { getSopRole } from '@/lib/sops/role';
import {
  attachUncheckedItems,
  completeIfFull,
  loadActiveRuns,
  loadRunChecks,
  loadRunState,
  loadViewableSopIds,
  resolveRunContent,
  runActors,
  type UncheckedItem,
} from '@/lib/sops/runs';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const PAGE = '/admin/sops';
const MAX_ITEM_TEXT = 500;
const LIST_LIMIT = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CheckItem {
  itemIndex: number;
  itemText: string;
  /** Resolved by skipping rather than completing. */
  skipped: boolean;
}

/** Every task in `content` as a completed check item, for checkAll. */
function allItems(content: string): CheckItem[] {
  return parseChecklist(content).tasks.map((task) => ({
    itemIndex: task.index,
    itemText: task.text.slice(0, MAX_ITEM_TEXT),
    skipped: false,
  }));
}

/**
 * The refusal for a skip of an item the document requires. Names the items so
 * the banner says which ones — a client only sends this when its copy of the
 * document is older than the run's, so the person needs to know what changed.
 */
function skipRefused(blocked: CheckItem[]): Response {
  return json(
    {
      error: `These items must be checked off, not skipped: ${blocked
        .map((item) => item.itemText)
        .join(', ')}`,
    },
    400
  );
}

/** The row a check item writes, on the given run, by the given person. */
function checkRow(runId: string, item: CheckItem, email: string) {
  return {
    run_id: runId,
    item_index: item.itemIndex,
    item_text: item.itemText,
    checked_by: email,
    skipped: item.skipped,
  };
}

/**
 * A list of checks from a request body, deduped by index — or an error string.
 * Checking a parent task checks its whole subtree, so both the start request
 * and the check action carry lists rather than single items. An item with
 * `skipped: true` is resolved as skipped; anything else completes it.
 */
function parseCheckItems(value: unknown): { items: CheckItem[] } | { error: string } {
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
    byIndex.set(itemIndex, { itemIndex, itemText, skipped: raw?.skipped === true });
  }
  return { items: [...byIndex.values()] };
}

/** A run row as the log query returns it, with its checks embedded. */
type RunWithChecks = SopRunRow & {
  sop_run_checks: Pick<SopRunCheckRow, 'item_index' | 'checked_by'>[];
  unchecked?: UncheckedItem[];
};

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const role = await getSopRole(gate.user.email ?? null, gate.access);
  const viewer: SopViewer = { role, email: normalizeEmail(gate.user.email) };

  // Every unfinished run on a document this role may view, newest first —
  // not scoped to the caller's own runs the way the log below is (see
  // loadActiveRuns). Feeds the "in progress" strip at the top of the library.
  if (url.searchParams.get('view') === 'active') {
    const { runs, error } = await loadActiveRuns(db, viewer, LIST_LIMIT);
    if (error) return json({ error }, 500);

    return json({
      // Names for whoever started these runs, so the strip reads as people —
      // and the caller's own email, so the ones they started stand out.
      runs,
      viewer: viewer.email,
      people: await getPeopleNames(runs.map((run) => run.started_by)),
    });
  }

  // Run log, newest first, with sop identity and the full per-item check
  // record embedded. Everyone sees the log — it is the shared record of who
  // has completed what — scoped for non-admins to the documents they may view
  // (see below); admins see every run, archived documents included. ?sopId=
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
        '*, sops(title, slug, category), sop_run_checks(item_index, item_text, checked_by, checked_at, skipped)'
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

    // Non-admins read the whole log too — seeing who has completed what is the
    // point of it. The line that remains is the document's: a run's checks
    // quote the SOP's items, so a run is readable by exactly the people who
    // may read the SOP it ran. Narrowing on sop_id up front (rather than
    // filtering the fetched rows) keeps LIST_LIMIT honest — post-filtering
    // would take the newest 100 runs and then throw most of them away, leaving
    // a restricted viewer a near-empty page.
    if (!gate.access.isAdmin) {
      const { ids, error: idsError } = await loadViewableSopIds(db, viewer, listSopId);
      if (idsError) return json({ error: idsError }, 500);
      // Nothing readable: answer directly rather than send an empty in.().
      if (ids.length === 0) {
        return json({ runs: [], scope: 'visible', viewer: viewer.email, people: {} });
      }
      query = query.in('sop_id', ids);
    }

    const { data, error } = await query;
    if (error) return json({ error: error.message }, 500);
    const runRows = (data ?? []) as RunWithChecks[];
    // Name the items each short-ended run skipped, so the log shows what was
    // left undone rather than only how many items were. Best effort: a
    // snapshot lookup failure keeps the log itself readable.
    const { error: uncheckedError } = await attachUncheckedItems(db, runRows);
    if (uncheckedError) console.error('sop-runs: unchecked items lookup failed', uncheckedError);
    return json({
      runs: runRows,
      scope: gate.access.isAdmin ? 'all' : 'visible',
      // The caller's own email, so the log can mark the runs they started.
      viewer: viewer.email,
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

    const { state, error: stateError } = await loadRunState(db, sop);
    if (stateError) return json({ error: stateError }, 500);
    if (!state) return json({ run: null });
    return json({
      ...state,
      people: await getPeopleNames(runActors(state.run, state.checks)),
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

  const [{ data: checks, error: checksError }, { content, error: contentError }] =
    await Promise.all([loadRunChecks(db, run.id), resolveRunContent(db, sop, run as SopRunRow)]);
  if (checksError) return json({ error: checksError.message }, 500);
  if (contentError) return json({ error: contentError }, 500);

  const runChecks = (checks ?? []) as SopRunCheckRow[];
  return json({
    run,
    checks: runChecks,
    content,
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
    if ('error' in parsed) return json({ error: `initialChecks: ${parsed.error}` }, 400);
    initialChecks = parsed.items;
  }
  // Check every item of the document's run (starting one if needed): a parent
  // checklist ticked off the item that links to this one, so the whole
  // sub-checklist counts as done. The items come from the run's own snapshot,
  // so the texts on record are the real ones.
  const checkAll = body.checkAll === true;
  if (checkAll && initialChecks) {
    return json({ error: 'checkAll and initialChecks are exclusive' }, 400);
  }

  // The document and any open run on it are independent reads — both keyed
  // on sopId — so they go out together. (One in-progress run per document:
  // starting while one is open resumes it; two people splitting a checklist
  // share the run — that's the point.)
  const [sopResult, existingResult, role] = await Promise.all([
    db.from('sops').select('*').eq('id', sopId).maybeSingle(),
    db
      .from('sop_runs')
      .select('*')
      .eq('sop_id', sopId)
      .eq('status', 'in_progress')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    getSopRole(gate.user.email ?? null, gate.access),
  ]);
  if (sopResult.error) return json({ error: sopResult.error.message }, 500);
  const sop = (sopResult.data as SopRow) ?? null;

  const viewer: SopViewer = { role, email: normalizeEmail(gate.user.email) };
  if (!sop || !canViewSop(viewer, sop)) return json({ error: 'SOP not found' }, 404);
  if (sop.archived) return json({ error: 'This SOP is archived' }, 400);

  const taskCount = countTasks(sop.content_md);
  if (taskCount === 0) return json({ error: 'This SOP has no checklist items' }, 400);
  if (initialChecks?.some((item) => item.itemIndex >= taskCount)) {
    return json({ error: `initialChecks indexes must be in [0, ${taskCount})` }, 400);
  }

  if (existingResult.error) return json({ error: existingResult.error.message }, 500);
  const existing = existingResult.data;

  if (existing) {
    const run = existing as SopRunRow;
    // The run's own snapshot, needed to expand checkAll and to know which
    // items that snapshot marks required. Skipped nothing and checking
    // nothing wholesale? Then it isn't read at all.
    let runContent: string | null = null;
    const skipping = initialChecks?.some((item) => item.skipped) ?? false;
    if (checkAll || skipping) {
      const resolved = await resolveRunContent(db, sop, run);
      if (resolved.error) return json({ error: resolved.error }, 500);
      runContent = resolved.content;
      if (checkAll) initialChecks = allItems(runContent);
    }
    // The tap that meant "start" joins the run someone else already opened.
    // Indexes are validated against that run's (possibly older) snapshot — a
    // tap past its task list is dropped rather than misfiled.
    const joinable = (initialChecks ?? []).filter((item) => item.itemIndex < run.task_count);
    if (runContent !== null) {
      const blocked = forbiddenSkips(runContent, joinable);
      if (blocked.length > 0) return skipRefused(blocked);
    }
    if (joinable.length > 0) {
      const { error: checkError } = await db.from('sop_run_checks').upsert(
        joinable.map((item) => checkRow(run.id, item, gate.user.email ?? '')),
        { onConflict: 'run_id,item_index', ignoreDuplicates: true }
      );
      if (checkError) return json({ error: checkError.message }, 500);
    }
    const [{ data: checks, error: checksError }, { content }] = await Promise.all([
      loadRunChecks(db, run.id),
      runContent !== null
        ? Promise.resolve({ content: runContent })
        : resolveRunContent(db, sop, run),
    ]);
    if (checksError) return json({ error: checksError.message }, 500);
    const runChecks = (checks ?? []) as SopRunCheckRow[];
    const full = await completeIfFull(db, run, runChecks, gate.user.email ?? '');
    if (full.error) return json({ error: full.error }, 500);
    return json({
      run: full.run,
      checks: runChecks,
      content,
      resumed: true,
      people: await getPeopleNames(runActors(full.run, runChecks)),
    });
  }

  // A fresh run pins the current version, so the current text is the one its
  // required items come from.
  if (initialChecks) {
    const blocked = forbiddenSkips(sop.content_md, initialChecks);
    if (blocked.length > 0) return skipRefused(blocked);
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
  if (checkAll) initialChecks = allItems(sop.content_md);
  if (initialChecks) {
    // No transaction over PostgREST: if this insert fails, best-effort delete
    // the just-created run so the failed tap doesn't leave an empty run
    // behind. (A crash between the two statements can — the uncheck
    // auto-discard and explicit Discard both clean that up.)
    const { data: checkRows, error: checkError } = await db
      .from('sop_run_checks')
      .insert(initialChecks.map((item) => checkRow(newRun.id, item, gate.user.email ?? '')))
      .select('*');
    if (checkError) {
      await db.from('sop_runs').delete().eq('id', newRun.id);
      return json({ error: checkError.message }, 500);
    }
    newChecks = (checkRows ?? []) as SopRunCheckRow[];
  }
  const full = await completeIfFull(db, newRun, newChecks, gate.user.email ?? '');
  if (full.error) return json({ error: full.error }, 500);
  return json(
    {
      run: full.run,
      checks: newChecks,
      content: sop.content_md,
      resumed: false,
      people: await getPeopleNames(runActors(full.run, newChecks)),
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

  // There is deliberately no 'complete': a run finishes itself when its last
  // item is resolved, so the record never carries items nobody accounted for.
  const action = body.action;
  if (typeof action !== 'string' || !['check', 'uncheck', 'discard'].includes(action)) {
    return json({ error: 'action must be check, uncheck, or discard' }, 400);
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
    // One or many items — tapping a parent task resolves its whole subtree.
    // A bare { itemIndex, itemText, skipped } is accepted as shorthand for
    // one item.
    const parsed = parseCheckItems(
      body.items !== undefined
        ? body.items
        : [{ itemIndex: body.itemIndex, itemText: body.itemText, skipped: body.skipped }]
    );
    if ('error' in parsed) return json({ error: parsed.error }, 400);
    if (parsed.items.some((item) => item.itemIndex >= run.task_count)) {
      return json({ error: `itemIndex must be an integer in [0, ${run.task_count})` }, 400);
    }

    // Required items take completion only. Checked against the snapshot the
    // run pinned — the same text the checklist on screen is rendering — and
    // only when something is actually being skipped, so an ordinary check
    // still costs no extra read.
    if (parsed.items.some((item) => item.skipped)) {
      const { content, error: contentError } = await resolveRunContent(db, sop, run as SopRunRow);
      if (contentError) return json({ error: contentError }, 500);
      const blocked = forbiddenSkips(content, parsed.items);
      if (blocked.length > 0) return skipRefused(blocked);
    }

    // The (run_id, item_index) unique constraint makes a double-check from two
    // devices a no-op instead of an error — and keeps the first resolution
    // (a skip never silently overwrites a teammate's check, or vice versa;
    // un-resolving first is the way to change one).
    const { error } = await db.from('sop_run_checks').upsert(
      parsed.items.map((item) => checkRow(runId, item, email)),
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

    // Un-resolving covers skipped items too: the row goes either way. Runs
    // start implicitly with the first check, so they end implicitly when
    // the last one goes: nothing resolved means nothing happened, and the run
    // vanishes like a discard. The remaining checks are the response anyway,
    // so their count doubles as the test. Race note: if a teammate's check
    // lands between the delete above and this read, the list is non-empty and
    // the run survives (correct); if their check is in flight when the run
    // row goes, that insert fails on the FK and their client retries as a
    // fresh start.
    const { data: remaining, error: remainingError } = await loadRunChecks(db, runId);
    if (remainingError) return json({ error: remainingError.message }, 500);
    const remainingChecks = (remaining ?? []) as SopRunCheckRow[];
    if (remainingChecks.length === 0) {
      const { error: discardError } = await db
        .from('sop_runs')
        .delete()
        .eq('id', runId)
        .eq('status', 'in_progress');
      if (discardError) return json({ error: discardError.message }, 500);
      return json({ run: null, checks: [], discarded: true });
    }
    return json({
      run,
      checks: remainingChecks,
      people: await getPeopleNames(runActors(run, remainingChecks)),
    });
  } else {
    // discard — started by mistake: erase the run and its checks (they
    // cascade) so nothing lands in the log. Only reachable while in progress
    // — the status guard above already rejected finished runs.
    const { error } = await db
      .from('sop_runs')
      .delete()
      .eq('id', runId)
      .eq('status', 'in_progress');
    if (error) return json({ error: error.message }, 500);
    return json({ run: null, checks: [], discarded: true });
  }

  // check: re-read the checks — the whole list, since a parent tap may have
  // added several and a teammate may have added more since the client last
  // looked — and finish the run if that was the last of them (skipped items
  // count: the run is done once every item is accounted for).
  const { data: checks, error: checksError } = await loadRunChecks(db, runId);
  if (checksError) return json({ error: checksError.message }, 500);
  const runChecks = (checks ?? []) as SopRunCheckRow[];
  const full = await completeIfFull(db, run, runChecks, email);
  if (full.error) return json({ error: full.error }, 500);
  return json({
    run: full.run,
    checks: runChecks,
    people: await getPeopleNames(runActors(full.run, runChecks)),
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
