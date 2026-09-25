// Agent suggestions, for the admins who decide them. Everything here is
// admin-only: suggestions are proposals about other people's notes and the
// team's boards and SOPs, and nothing an agent proposes happens until an
// admin approves it here. See lib/suggestions for the lifecycle.
//
//   GET ?source=shift_note&ids=a,b  → { suggestions: { [id]: SuggestionView[] },
//                                       runs: { [id]: RunView }, results, targets }
//   GET ?status=pending|decided&kind=&sourceType=&limit=
//                                    → { suggestions, sources, results, targets, people }  (the inbox)
//   GET ?count=1                     → { pending }
//   GET ?context=boards              → { boards } (the card editor's pickers)
//   GET ?context=sop&id=<uuid>       → { sop } (current text, for the diff)
//   PATCH { id, payload }            → { suggestion }  (save a working copy)
//   POST { action: 'approve', id, payload?, note? } → { suggestion, result }
//   POST { action: 'dismiss', id, note? }           → { suggestion }
//   POST { action: 'rebase', id }                   → { suggestion } | 409 { detail }
//   POST { action: 'suggest', sourceType, sourceId } → 202 { run }
//
// Mutations are CSRF-guarded in-route via assertSameOrigin.

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin } from '@/lib/auth/admin';
import type { AgentSuggestionRow, AgentSuggestionRunRow, BoardFieldRow } from '@/lib/db';
import { getDb } from '@/lib/db';
import { getSetting } from '@/lib/settings/store';
import { getPeopleNames } from '@/lib/sops/people';
import {
  approveSuggestion,
  type DecisionResult,
  dismissSuggestion,
  editSuggestion,
  rebaseSuggestion,
} from '@/lib/suggestions/approve';
import { dispatchSuggestion } from '@/lib/suggestions/dispatch';
import { createManualRun, latestRuns, runState } from '@/lib/suggestions/runs';
import { suggesterConfigured } from '@/lib/suggestions/session';
import { type SourceRecord, SUGGESTION_SOURCES } from '@/lib/suggestions/sources';
import {
  countPending,
  type InboxFilter,
  listForSources,
  listInbox,
  resolveLinks,
} from '@/lib/suggestions/store';
import {
  isSuggestionKind,
  isSuggestionSourceType,
  isUuid,
  MAX_DECISION_NOTE,
  type RunView,
  type SourceSummary,
  type SuggestionView,
} from '@/lib/suggestions/types';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const MAX_IDS = 100;
const INBOX_LIMIT = 100;

function toRunView(run: AgentSuggestionRunRow): RunView {
  const status = runState(run);
  return {
    id: run.id,
    status,
    trigger: run.trigger,
    count: run.suggestion_count,
    error: status === 'failed' && !run.error ? 'The agent did not finish; try again' : run.error,
    createdAt: run.created_at,
  };
}

function toView(row: AgentSuggestionRow, source: SourceRecord | undefined): SuggestionView {
  return { ...row, sourceChanged: source ? source.hash !== row.source_hash : false };
}

function decision(result: DecisionResult): Response {
  if (result.ok) {
    return json({
      suggestion: result.suggestion,
      ...(result.result ? { result: result.result } : {}),
    });
  }
  return json(
    {
      error: result.error,
      ...(result.detail ? { detail: result.detail } : {}),
      ...(result.suggestion ? { suggestion: result.suggestion } : {}),
    },
    result.status
  );
}

function noteOf(value: unknown): string | null {
  return typeof value === 'string' ? value.slice(0, MAX_DECISION_NOTE) : null;
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;
  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const params = url.searchParams;

  if (params.get('count')) return json({ pending: await countPending(db) });

  const context = params.get('context');
  if (context === 'boards') {
    const [boards, columns, fields] = await Promise.all([
      db
        .from('boards')
        .select('id, slug, name, card_noun')
        .eq('archived', false)
        .order('sort_order'),
      db
        .from('board_columns')
        .select('board_id, key, label, kind, sort_order')
        .eq('archived', false)
        .order('sort_order'),
      db
        .from('board_fields')
        .select('*')
        .eq('archived', false)
        .neq('kind', 'files')
        .order('sort_order'),
    ]);
    const error = boards.error ?? columns.error ?? fields.error;
    if (error) return json({ error: error.message }, 500);
    return json({
      boards: (boards.data ?? []).map((b) => ({
        ...b,
        columns: (columns.data ?? []).filter((c) => c.board_id === b.id && c.kind === 'open'),
        fields: ((fields.data ?? []) as BoardFieldRow[]).filter((f) => f.board_id === b.id),
      })),
    });
  }
  if (context === 'sop') {
    const id = params.get('id');
    if (!isUuid(id)) return json({ error: 'id must be a UUID' }, 400);
    const { data, error } = await db
      .from('sops')
      .select('id, slug, title, content_md, current_version')
      .eq('id', id)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: 'SOP not found' }, 404);
    return json({ sop: data });
  }

  const sourceType = params.get('source');
  if (sourceType) {
    if (!isSuggestionSourceType(sourceType)) return json({ error: 'Unknown source' }, 400);
    const ids = (params.get('ids') ?? '').split(',').filter(isUuid);
    if (ids.length === 0) return json({ suggestions: {}, runs: {}, results: {}, targets: {} });
    if (ids.length > MAX_IDS) return json({ error: `At most ${MAX_IDS} ids` }, 400);

    const [byId, runs, sources] = await Promise.all([
      listForSources(db, sourceType, ids),
      latestRuns(db, sourceType, ids),
      SUGGESTION_SOURCES[sourceType].loadMany(db, ids).catch(() => new Map<string, SourceRecord>()),
    ]);
    const all = [...byId.values()].flat();
    return json({
      suggestions: Object.fromEntries(
        [...byId].map(([id, rows]) => [id, rows.map((row) => toView(row, sources.get(id)))])
      ),
      runs: Object.fromEntries([...runs].map(([id, run]) => [id, toRunView(run)])),
      ...(await resolveLinks(db, all)),
    });
  }

  // The inbox.
  const status = params.get('status') ?? 'pending';
  if (status !== 'pending' && status !== 'decided') {
    return json({ error: 'status must be pending or decided' }, 400);
  }
  const kind = params.get('kind');
  const inboxSource = params.get('sourceType');
  const filter: InboxFilter = {
    status,
    limit: Math.min(Number(params.get('limit')) || INBOX_LIMIT, INBOX_LIMIT),
    ...(isSuggestionKind(kind) ? { kind } : {}),
    ...(isSuggestionSourceType(inboxSource) ? { sourceType: inboxSource } : {}),
  };
  const { rows, error } = await listInbox(db, filter);
  if (error) return json({ error }, 500);

  const sources: Record<string, SourceSummary | null> = {};
  const byType = new Map<string, string[]>();
  for (const row of rows) {
    const list = byType.get(row.source_type) ?? [];
    list.push(row.source_id);
    byType.set(row.source_type, list);
  }
  const loaded = new Map<string, SourceRecord>();
  for (const [type, ids] of byType) {
    if (!isSuggestionSourceType(type)) continue;
    const records = await SUGGESTION_SOURCES[type]
      .loadMany(db, [...new Set(ids)])
      .catch(() => new Map<string, SourceRecord>());
    for (const id of ids) {
      const record = records.get(id);
      if (record) loaded.set(`${type}:${id}`, record);
      sources[`${type}:${id}`] = record
        ? { label: record.label, href: record.href, excerpt: record.text.slice(0, 280) }
        : null;
    }
  }

  return json({
    suggestions: rows.map((row) => toView(row, loaded.get(`${row.source_type}:${row.source_id}`))),
    sources,
    ...(await resolveLinks(db, rows)),
    people: await getPeopleNames(
      rows.flatMap((r) => [r.decided_by, r.edited_by]).filter((e): e is string => !!e)
    ),
    agentsConfigured: suggesterConfigured(),
    suggestionsEnabled: await getSetting('suggestions.enabled'),
  });
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!isUuid(body.id)) return json({ error: 'id must be a UUID' }, 400);
  const by = (gate.user.email ?? '').trim().toLowerCase();
  return decision(await editSuggestion(db, body.id, { payload: body.payload, by }));
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requireAdmin(cookies);
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
  const by = (gate.user.email ?? '').trim().toLowerCase();
  if (!by) return json({ error: 'Session has no email' }, 400);

  switch (body.action) {
    case 'approve':
      if (!isUuid(body.id)) return json({ error: 'id must be a UUID' }, 400);
      return decision(
        await approveSuggestion(db, body.id, {
          ...(body.payload !== undefined ? { payload: body.payload } : {}),
          note: noteOf(body.note),
          by,
        })
      );
    case 'dismiss':
      if (!isUuid(body.id)) return json({ error: 'id must be a UUID' }, 400);
      return decision(await dismissSuggestion(db, body.id, { note: noteOf(body.note), by }));
    case 'rebase':
      if (!isUuid(body.id)) return json({ error: 'id must be a UUID' }, 400);
      return decision(await rebaseSuggestion(db, body.id, by));
    case 'suggest': {
      const { sourceType, sourceId } = body;
      if (!isSuggestionSourceType(sourceType) || !isUuid(sourceId)) {
        return json({ error: 'sourceType and sourceId are required' }, 400);
      }
      if (!suggesterConfigured()) {
        return json(
          { error: 'The agents app is not configured (AGENTS_BASE_URL / EVE_CHANNEL_SECRET)' },
          503
        );
      }
      if (!(await getSetting('suggestions.enabled'))) {
        return json({ error: 'Suggestions are turned off in Settings' }, 409);
      }
      const source = await SUGGESTION_SOURCES[sourceType].load(db, sourceId);
      if (!source) return json({ error: 'Not found' }, 404);
      const filed = await createManualRun(db, source, by);
      if (!filed.ok) return json({ error: filed.error }, 500);
      const { run } = filed;
      const dispatched = await dispatchSuggestion({
        sourceType,
        sourceId,
        trigger: 'manual',
        runId: run.id,
      });
      if (dispatched.via === 'none') return json({ error: dispatched.reason }, 503);
      return json({ run: toRunView(run) }, 202);
    }
    default:
      return json({ error: 'action must be approve, dismiss, rebase, or suggest' }, 400);
  }
};
