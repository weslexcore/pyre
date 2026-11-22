// SOP, message and inventory changes Pyre Agent suggests in a conversation. Unlike its
// board and inventory proposals (./actions), which the asker applies as
// themselves, these go through the same suggestion pipeline as the shift-note
// suggester (lib/suggestions): checked by the same intake, stored in
// agent_suggestions with the conversation as the source, edited and approved
// with the same editors by the same people (admins and the Suggestions page),
// and listed in the same inbox. Someone who can decide suggestions does it
// right in the chat; anyone else's go to the admins, who are notified.
// Server-only.

import type { SupabaseClient } from '@supabase/supabase-js';
import { canViewPage, type PageAccess, SUGGESTIONS_HREF } from '@/components/admin/adminTools';
import { contentHash } from '@/lib/classify/hash';
import type { AgentSuggestionRow } from '@/lib/db';
import { conversationOf } from '@/lib/knowledge/conversation';
import { canViewMessage } from '@/lib/messages/access';
import { getSetting } from '@/lib/settings/store';
import { canViewSop, type SopViewer } from '@/lib/sops/levels';
import { type CountCredit, intakeSuggestions } from '@/lib/suggestions/intake';
import { notifySuggestionsReady } from '@/lib/suggestions/notify';
import { createManualRun } from '@/lib/suggestions/runs';
import { type SourceRecord, SUGGESTION_SOURCES } from '@/lib/suggestions/sources';
import { insertSuggestions } from '@/lib/suggestions/store';
import {
  describeSuggestion,
  type InventorySuggestionKind,
  isInventorySuggestionKind,
  isUuid,
  MAX_INVENTORY_PER_RUN,
  type SuggestionKind,
  sourceHref,
} from '@/lib/suggestions/types';

/** The suggestion kinds Pyre Agent files; the rest are the shift-note suggester's. */
export const PYRE_AGENT_SUGGESTION_KINDS = [
  'sop.edit',
  'sop.create',
  'message.create',
  'message.edit',
] as const;
export type PyreAgentSuggestionKind = (typeof PYRE_AGENT_SUGGESTION_KINDS)[number];

export function isPyreAgentSuggestionKind(value: unknown): value is PyreAgentSuggestionKind {
  return (
    typeof value === 'string' && (PYRE_AGENT_SUGGESTION_KINDS as readonly string[]).includes(value)
  );
}

/** Whether this person decides suggestions themselves (as on Shift Notes and the inbox). */
export function canDecideSuggestions(access: PageAccess): boolean {
  return access.isAdmin || canViewPage(access, SUGGESTIONS_HREF);
}

export type SuggestResult =
  | {
      ok: true;
      suggestion: { id: string; kind: SuggestionKind; summary: string; status: string };
      /** Who decides it: the asker, in the chat, or the admins. */
      reviewer: 'you' | 'admins';
    }
  | { ok: false; status: 400 | 403 | 404 | 409 | 422 | 500; error: string };

/**
 * The conversation as a suggestion source. Its first question is logged as
 * the turn starts, so it is almost always there; if the log is behind, the
 * suggestion still files against the conversation under the asker's name.
 */
async function conversationSource(
  db: SupabaseClient,
  conversationId: string,
  email: string
): Promise<SourceRecord> {
  const loaded = await SUGGESTION_SOURCES.pyre_agent.load(db, conversationId).catch(() => null);
  if (loaded) return { ...loaded, author: loaded.author || email };
  const now = new Date().toISOString();
  return {
    type: 'pyre_agent',
    id: conversationId,
    text: '',
    hash: contentHash(''),
    label: 'Pyre Agent chat',
    href: sourceHref('pyre_agent', conversationId),
    closed: false,
    author: email,
    recordedAt: now,
  };
}

/**
 * Refuses what the asker could not see themselves: an SOP or message outside
 * their access. A new SOP acts on nothing that exists, so anyone may suggest
 * one; only an admin can approve it.
 */
async function checkReach(
  db: SupabaseClient,
  viewer: SopViewer,
  kind: PyreAgentSuggestionKind,
  payload: Record<string, unknown>
): Promise<string | null> {
  if (kind === 'sop.edit') {
    const slug = typeof payload.slug === 'string' ? payload.slug.trim() : '';
    const { data } = slug
      ? await db
          .from('sops')
          .select('view_roles, edit_roles, view_emails, edit_emails, archived')
          .eq('slug', slug)
          .maybeSingle()
      : { data: null };
    if (!data || !canViewSop(viewer, data as Parameters<typeof canViewSop>[1])) {
      return `No SOP "${slug}" this person can read; use list_sops for the slugs`;
    }
  }
  if (kind === 'message.edit') {
    const id = typeof payload.messageId === 'string' ? payload.messageId : '';
    const { data } = id
      ? await db
          .from('admin_messages')
          .select(
            'author_email, audience_roles, audience_emails, archived_at, sent_at, shared_with'
          )
          .eq('id', id)
          .maybeSingle()
      : { data: null };
    if (!data || !canViewMessage(viewer, data as Parameters<typeof canViewMessage>[1])) {
      return 'No message with that id this person can read; use get_messages for the ids';
    }
  }
  return null;
}

/**
 * Check one suggestion from the conversation and file it pending, the way
 * the suggester files a shift note's. Each call is its own run, closed as it
 * is filed; a later suggestion never supersedes an earlier one.
 */
export async function suggestFromConversation(
  db: SupabaseClient,
  access: PageAccess,
  context: { email: string; viewer: SopViewer; sessionId: string },
  kind: PyreAgentSuggestionKind,
  input: { payload: Record<string, unknown>; rationale: string }
): Promise<SuggestResult> {
  if (!(await getSetting('suggestions.enabled'))) {
    return {
      ok: false,
      status: 409,
      error:
        'Suggestions are turned off in Settings, so this cannot be filed; tell the person to make the change on the page itself, or ask an admin to turn suggestions on',
    };
  }
  const unreachable = await checkReach(db, context.viewer, kind, input.payload);
  if (unreachable) return { ok: false, status: 422, error: unreachable };

  const conversationId = await conversationOf(db, context.email, context.sessionId);
  const source = await conversationSource(db, conversationId, context.email);
  const intake = await intakeSuggestions(
    db,
    [{ kind, payload: input.payload, rationale: input.rationale }],
    source
  );
  if (!intake.ok) return { ok: false, status: intake.status, error: intake.error };

  const run = await createManualRun(db, source, context.email);
  if (!run.ok) return { ok: false, status: 500, error: run.error };
  const saved = await insertSuggestions(db, run.run, intake.suggestions, context.sessionId);
  if ('error' in saved) return { ok: false, status: 500, error: saved.error };
  const row = saved.rows[0] as AgentSuggestionRow | undefined;
  if (!row) return { ok: false, status: 500, error: 'The suggestion was not saved' };

  // Someone who decides suggestions reviews this one in the chat right now;
  // anyone else's waits for the admins, so they are told.
  const reviewer = canDecideSuggestions(access) ? 'you' : 'admins';
  if (reviewer === 'admins') await notifySuggestionsReady(db, source, saved.rows);

  return {
    ok: true,
    suggestion: {
      id: row.id,
      kind: row.kind,
      summary: describeSuggestion(row.kind, row.payload),
      status: row.status,
    },
    reviewer,
  };
}

/** One inventory change Pyre Agent read out of a shift note. */
export interface InventoryChangeInput {
  kind: InventorySuggestionKind;
  payload: Record<string, unknown>;
  rationale: string;
  /** The shift note it was read from: the count is credited to its author, at its time. */
  shiftNoteId: string | null;
}

export type SuggestManyResult =
  | {
      ok: true;
      suggestions: { id: string; kind: SuggestionKind; summary: string; status: string }[];
      reviewer: 'you' | 'admins';
    }
  | { ok: false; status: 400 | 403 | 404 | 409 | 422 | 500; error: string; index?: number };

/** Parse the agent's list of inventory changes; an error names the entry to fix. */
export function parseInventoryChanges(
  raw: unknown
): { ok: true; changes: InventoryChangeInput[] } | { ok: false; error: string; index?: number } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'changes must list at least one inventory change' };
  }
  if (raw.length > MAX_INVENTORY_PER_RUN) {
    return { ok: false, error: `At most ${MAX_INVENTORY_PER_RUN} changes at once` };
  }
  const changes: InventoryChangeInput[] = [];
  for (const [index, entry] of raw.entries()) {
    const o =
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : null;
    if (!o || !isInventorySuggestionKind(o.kind)) {
      return { ok: false, error: 'kind must be inventory.count or inventory.create', index };
    }
    const { kind, rationale, shiftNoteId, ...payload } = o;
    if (shiftNoteId !== undefined && shiftNoteId !== null && !isUuid(shiftNoteId)) {
      return { ok: false, error: 'shiftNoteId must be a note id from get_shift_notes', index };
    }
    changes.push({
      kind,
      payload,
      rationale: typeof rationale === 'string' ? rationale : '',
      shiftNoteId: (shiftNoteId as string | null | undefined) ?? null,
    });
  }
  return { ok: true, changes };
}

/**
 * The shift notes the changes were read from, as count credits: each note's
 * author and time. Only notes the asker can read themselves count — every
 * note for an admin, otherwise the team's notes and their own — so nobody
 * can credit a count to a note they could not open.
 */
async function noteCredits(
  db: SupabaseClient,
  access: PageAccess,
  email: string,
  changes: readonly InventoryChangeInput[]
): Promise<
  { ok: true; credits: (CountCredit | undefined)[] } | { ok: false; error: string; index: number }
> {
  const ids = [...new Set(changes.map((c) => c.shiftNoteId).filter((id): id is string => !!id))];
  const readable = new Map<string, CountCredit>();
  if (ids.length > 0) {
    const { data, error } = await db
      .from('shift_notes')
      .select('id, author_email, admin_only, created_at')
      .in('id', ids);
    if (error) throw new Error(error.message);
    for (const note of (data ?? []) as {
      id: string;
      author_email: string;
      admin_only: boolean;
      created_at: string;
    }[]) {
      const author = note.author_email.trim().toLowerCase();
      if (access.isAdmin || !note.admin_only || author === email) {
        readable.set(note.id, { author, recordedAt: note.created_at });
      }
    }
  }
  const credits: (CountCredit | undefined)[] = [];
  for (const [index, change] of changes.entries()) {
    if (!change.shiftNoteId) {
      credits.push(undefined);
      continue;
    }
    const credit = readable.get(change.shiftNoteId);
    if (!credit) {
      return {
        ok: false,
        error: 'No shift note with that id; use get_shift_notes for the ids',
        index,
      };
    }
    credits.push(credit);
  }
  return { ok: true, credits };
}

/**
 * File a batch of inventory changes — counts on items the list has and new
 * items for supplies it doesn't — that Pyre Agent read out of shift notes,
 * as one run, so they are reviewed (and approved) together. Each count is
 * credited to the note it came from; one with no note, to the asker.
 */
export async function suggestInventoryFromConversation(
  db: SupabaseClient,
  access: PageAccess,
  context: { email: string; sessionId: string },
  changes: readonly InventoryChangeInput[]
): Promise<SuggestManyResult> {
  if (!(await getSetting('suggestions.enabled'))) {
    return {
      ok: false,
      status: 409,
      error:
        'Suggestions are turned off in Settings, so these cannot be filed; offer to propose the counts with propose_inventory_update instead, or ask an admin to turn suggestions on',
    };
  }
  const credited = await noteCredits(db, access, context.email, changes);
  if (!credited.ok) return { ok: false, status: 422, error: credited.error, index: credited.index };

  const conversationId = await conversationOf(db, context.email, context.sessionId);
  const source = await conversationSource(db, conversationId, context.email);
  const intake = await intakeSuggestions(
    db,
    changes.map((c) => ({ kind: c.kind, payload: c.payload, rationale: c.rationale })),
    source,
    credited.credits
  );
  if (!intake.ok) {
    return {
      ok: false,
      status: intake.status,
      error: intake.error,
      ...(intake.index !== undefined ? { index: intake.index } : {}),
    };
  }

  const run = await createManualRun(db, source, context.email);
  if (!run.ok) return { ok: false, status: 500, error: run.error };
  const saved = await insertSuggestions(db, run.run, intake.suggestions, context.sessionId);
  if ('error' in saved) return { ok: false, status: 500, error: saved.error };

  const reviewer = canDecideSuggestions(access) ? 'you' : 'admins';
  if (reviewer === 'admins') await notifySuggestionsReady(db, source, saved.rows);

  return {
    ok: true,
    suggestions: saved.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      summary: describeSuggestion(row.kind, row.payload),
      status: row.status,
    })),
    reviewer,
  };
}
