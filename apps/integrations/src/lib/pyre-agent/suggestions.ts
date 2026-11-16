// SOP and message changes Pyre Agent suggests in a conversation. Unlike its
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
import { intakeSuggestions } from '@/lib/suggestions/intake';
import { notifySuggestionsReady } from '@/lib/suggestions/notify';
import { createManualRun } from '@/lib/suggestions/runs';
import { type SourceRecord, SUGGESTION_SOURCES } from '@/lib/suggestions/sources';
import { insertSuggestions } from '@/lib/suggestions/store';
import { describeSuggestion, type SuggestionKind, sourceHref } from '@/lib/suggestions/types';

/** The suggestion kinds Pyre Agent files; the rest are the shift-note suggester's. */
export const PYRE_AGENT_SUGGESTION_KINDS = ['sop.edit', 'message.create', 'message.edit'] as const;
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

/** Refuses what the asker could not see themselves: an SOP or message outside their access. */
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
