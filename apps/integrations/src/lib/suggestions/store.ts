// Reading and writing agent suggestions. Server-only.
//
// State moves are conditional updates on the current status, because
// supabase-js has no transactions: claiming a pending suggestion for approval
// is `update … where status = 'pending'`, and whoever's update matched the row
// owns it. Two admins approving at once can't both apply it.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentSuggestionRow, AgentSuggestionRunRow, BoardCardRow } from '@/lib/db';
import { markDone } from './runs';
import {
  cardHref,
  type SuggestionKind,
  type SuggestionLinks,
  type SuggestionResultLink,
  type SuggestionSourceType,
  type SuggestionStatus,
} from './types';

/** One validated suggestion, ready to store. */
export interface NewSuggestion {
  kind: SuggestionKind;
  payload: Record<string, unknown>;
  rationale: string;
  confidence: number | null;
  target: { type: 'board_card' | 'sop'; id: string } | null;
}

/**
 * Store a run's suggestions and close the run. The source's older pending
 * suggestions that nobody has edited are superseded — the new run read the
 * same record again, more recently — while ones an admin has started editing
 * stay, so nobody's work vanishes under them.
 */
export async function insertSuggestions(
  db: SupabaseClient,
  run: AgentSuggestionRunRow,
  items: readonly NewSuggestion[],
  agentSessionId: string | null
): Promise<{ rows: AgentSuggestionRow[] } | { error: string }> {
  const { error: supersedeError } = await db
    .from('agent_suggestions')
    .update({ status: 'superseded' })
    .eq('source_type', run.source_type)
    .eq('source_id', run.source_id)
    .eq('status', 'pending')
    .is('edited_payload', null)
    .neq('run_id', run.id);
  if (supersedeError) {
    console.error('[suggestions] supersede failed:', supersedeError.message);
  }

  let rows: AgentSuggestionRow[] = [];
  if (items.length > 0) {
    const { data, error } = await db
      .from('agent_suggestions')
      .insert(
        items.map((item, position) => ({
          run_id: run.id,
          position,
          kind: item.kind,
          source_type: run.source_type,
          source_id: run.source_id,
          source_hash: run.source_hash,
          payload: item.payload,
          rationale: item.rationale.slice(0, 2000),
          confidence: item.confidence,
          target_type: item.target?.type ?? null,
          target_id: item.target?.id ?? null,
          agent_session_id: agentSessionId,
        }))
      )
      .select('*');
    if (error) return { error: error.message };
    rows = (data ?? []) as AgentSuggestionRow[];
  }
  await markDone(db, run.id, rows.length);
  return { rows };
}

export async function loadSuggestion(
  db: SupabaseClient,
  id: string
): Promise<AgentSuggestionRow | null> {
  const { data } = await db.from('agent_suggestions').select('*').eq('id', id).maybeSingle();
  return (data as AgentSuggestionRow) ?? null;
}

/** Every suggestion for these records except superseded ones, oldest first, keyed by source id. */
export async function listForSources(
  db: SupabaseClient,
  sourceType: SuggestionSourceType,
  ids: readonly string[]
): Promise<Map<string, AgentSuggestionRow[]>> {
  const out = new Map<string, AgentSuggestionRow[]>();
  if (ids.length === 0) return out;
  const { data, error } = await db
    .from('agent_suggestions')
    .select('*')
    .eq('source_type', sourceType)
    .in('source_id', [...ids])
    .neq('status', 'superseded')
    .order('created_at', { ascending: true })
    .order('position', { ascending: true });
  if (error) {
    console.error('[suggestions] read failed:', error.message);
    return out;
  }
  for (const row of (data ?? []) as AgentSuggestionRow[]) {
    const list = out.get(row.source_id);
    if (list) list.push(row);
    else out.set(row.source_id, [row]);
  }
  return out;
}

export interface InboxFilter {
  status: SuggestionStatus | 'decided';
  kind?: SuggestionKind;
  sourceType?: SuggestionSourceType;
  limit: number;
}

/** The inbox: newest first. `decided` means approved or dismissed. */
export async function listInbox(
  db: SupabaseClient,
  filter: InboxFilter
): Promise<{ rows: AgentSuggestionRow[]; error: string | null }> {
  let query = db.from('agent_suggestions').select('*');
  query =
    filter.status === 'decided'
      ? query.in('status', ['approved', 'dismissed'])
      : filter.status === 'pending'
        ? query.in('status', ['pending', 'applying'])
        : query.eq('status', filter.status);
  if (filter.kind) query = query.eq('kind', filter.kind);
  if (filter.sourceType) query = query.eq('source_type', filter.sourceType);
  const { data, error } = await query
    .order(filter.status === 'decided' ? 'decided_at' : 'created_at', { ascending: false })
    .limit(filter.limit);
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as AgentSuggestionRow[], error: null };
}

/** Pending suggestions everywhere — the nav badge. 0 on any failure. */
export async function countPending(db: SupabaseClient): Promise<number> {
  try {
    const { count, error } = await db
      .from('agent_suggestions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** Pending suggestions left on one source record. */
export async function countPendingFor(
  db: SupabaseClient,
  sourceType: SuggestionSourceType,
  sourceId: string
): Promise<number> {
  const { count } = await db
    .from('agent_suggestions')
    .select('id', { count: 'exact', head: true })
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .in('status', ['pending', 'applying']);
  return count ?? 0;
}

/** Save an admin's working copy. Only while pending. */
export async function saveEdit(
  db: SupabaseClient,
  id: string,
  payload: Record<string, unknown>,
  by: string
): Promise<AgentSuggestionRow | null> {
  const { data } = await db
    .from('agent_suggestions')
    .update({ edited_payload: payload, edited_by: by, edited_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  return (data as AgentSuggestionRow) ?? null;
}

/** Take a pending suggestion for approval; null if somebody else already did, or it was decided. */
export async function claim(db: SupabaseClient, id: string): Promise<AgentSuggestionRow | null> {
  const { data } = await db
    .from('agent_suggestions')
    .update({ status: 'applying', error: null })
    .eq('id', id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  return (data as AgentSuggestionRow) ?? null;
}

/** Put a claimed suggestion back after applying it failed, saying why. */
export async function release(db: SupabaseClient, id: string, error: string): Promise<void> {
  await db
    .from('agent_suggestions')
    .update({ status: 'pending', error: error.slice(0, 1000) })
    .eq('id', id)
    .eq('status', 'applying');
}

/** Close a claimed suggestion as approved, with what was applied and what it made. */
export async function finishApproved(
  db: SupabaseClient,
  id: string,
  fields: {
    applied: Record<string, unknown>;
    edited: Record<string, unknown> | null;
    resultType: NonNullable<AgentSuggestionRow['result_type']>;
    resultId: string;
    by: string;
    note: string | null;
  }
): Promise<AgentSuggestionRow | null> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('agent_suggestions')
    .update({
      status: 'approved',
      applied_payload: fields.applied,
      ...(fields.edited
        ? { edited_payload: fields.edited, edited_by: fields.by, edited_at: now }
        : {}),
      result_type: fields.resultType,
      result_id: fields.resultId,
      decided_by: fields.by,
      decided_at: now,
      decision_note: fields.note,
      error: null,
    })
    .eq('id', id)
    .eq('status', 'applying')
    .select('*')
    .maybeSingle();
  if (error) console.error('[suggestions] could not close approved suggestion:', error.message);
  return (data as AgentSuggestionRow) ?? null;
}

/** Dismiss a pending suggestion; null if it was not pending. */
export async function dismissPending(
  db: SupabaseClient,
  id: string,
  by: string,
  note: string | null
): Promise<AgentSuggestionRow | null> {
  const { data } = await db
    .from('agent_suggestions')
    .update({
      status: 'dismissed',
      decided_by: by,
      decided_at: new Date().toISOString(),
      decision_note: note,
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  return (data as AgentSuggestionRow) ?? null;
}

/**
 * The links the review UI shows per suggestion, keyed by suggestion id:
 * `results` — where an approved one's result lives (the card it made or
 * commented on, the SOP it edited); `targets` — the existing card or SOP a
 * pending one acts on. Looked up in a few batched reads rather than stored,
 * so a card that moves boards still links to where it is now.
 */
export async function resolveLinks(
  db: SupabaseClient,
  rows: readonly AgentSuggestionRow[]
): Promise<SuggestionLinks> {
  const results: Record<string, SuggestionResultLink> = {};
  const targets: Record<string, SuggestionResultLink> = {};
  if (rows.length === 0) return { results, targets };

  const cardIds = new Set<string>();
  const sopIds = new Set<string>();
  for (const row of rows) {
    if (row.target_type === 'board_card' && row.target_id) cardIds.add(row.target_id);
    if (row.target_type === 'sop' && row.target_id) sopIds.add(row.target_id);
    if (row.result_type === 'board_card' && row.result_id) cardIds.add(row.result_id);
  }

  const cards = new Map<string, Pick<BoardCardRow, 'id' | 'title' | 'board_id'>>();
  const boardSlugs = new Map<string, string>();
  if (cardIds.size > 0) {
    const { data } = await db
      .from('board_cards')
      .select('id, title, board_id')
      .in('id', [...cardIds]);
    for (const card of (data ?? []) as Pick<BoardCardRow, 'id' | 'title' | 'board_id'>[]) {
      cards.set(card.id, card);
    }
    const boardIds = [...new Set([...cards.values()].map((c) => c.board_id))];
    if (boardIds.length > 0) {
      const { data: boards } = await db.from('boards').select('id, slug').in('id', boardIds);
      for (const b of (boards ?? []) as { id: string; slug: string }[])
        boardSlugs.set(b.id, b.slug);
    }
  }
  const sops = new Map<string, { slug: string; title: string }>();
  if (sopIds.size > 0) {
    const { data } = await db
      .from('sops')
      .select('id, slug, title')
      .in('id', [...sopIds]);
    for (const s of (data ?? []) as { id: string; slug: string; title: string }[]) {
      sops.set(s.id, { slug: s.slug, title: s.title });
    }
  }

  const cardLink = (id: string | null): SuggestionResultLink => {
    const card = id ? cards.get(id) : undefined;
    const slug = card ? boardSlugs.get(card.board_id) : undefined;
    return card && slug
      ? { label: card.title, href: cardHref(slug, card.id) }
      : { label: 'Task (deleted)', href: null };
  };
  const sopLink = (id: string | null): SuggestionResultLink => {
    const sop = id ? sops.get(id) : undefined;
    return sop
      ? { label: sop.title, href: `/admin/sops/${sop.slug}` }
      : { label: 'SOP (deleted)', href: null };
  };

  for (const row of rows) {
    if (row.target_type === 'board_card') targets[row.id] = cardLink(row.target_id);
    if (row.target_type === 'sop') targets[row.id] = sopLink(row.target_id);
    if (row.status !== 'approved' || !row.result_id) continue;
    if (row.result_type === 'board_card') results[row.id] = cardLink(row.result_id);
    else if (row.result_type === 'board_event') results[row.id] = cardLink(row.target_id);
    else if (row.result_type === 'sop_version') results[row.id] = sopLink(row.target_id);
  }
  return { results, targets };
}
