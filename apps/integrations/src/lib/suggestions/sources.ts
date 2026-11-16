// This app's side of each record type a suggestion can come from: how to read
// it, how to describe and link to it, and whether it should be looked at
// automatically. Deliberately free of auth and request-side imports (the
// admin route does the gating), so the background paths — the classifier's
// after-hook, the QStash worker — can import it. The Record type makes a new
// source in ./types a type error here until it is wired up.

import { readStoredSignals, type Signal } from '@pyre/signals-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { contentHash } from '@/lib/classify/hash';
import type { ShiftNoteRow } from '@/lib/db';
import { type SuggestionSourceType, sourceHref } from './types';

/** A source record as the suggestion pipeline sees it. */
export interface SourceRecord {
  type: SuggestionSourceType;
  id: string;
  /** The text the agent reads, and the hash of it. */
  text: string;
  hash: string;
  /** A short name for links and notifications: "Maya's shift note (Sep 24)". */
  label: string;
  href: string;
  /** Whether the work it describes is already dealt with (a resolved note). */
  closed: boolean;
  /**
   * Who wrote it (their email), and when. A suggestion that records an
   * observation from the text (an inventory count) credits it to them, at
   * that time, rather than to the admin who approved it.
   */
  author: string | null;
  recordedAt: string;
}

export interface SuggestionSource {
  load(db: SupabaseClient, id: string): Promise<SourceRecord | null>;
  loadMany(db: SupabaseClient, ids: readonly string[]): Promise<Map<string, SourceRecord>>;
  /**
   * Whether a classification of this record should start a suggestion run on
   * its own: the record is still open and the classifier found one of
   * `autoSignals` in it (the suggestions.autoSignals setting). An admin's
   * AI button ignores this.
   */
  autoEligible(record: SourceRecord, signals: unknown, autoSignals: readonly string[]): boolean;
  /**
   * Whether a new run over the record replaces its older pending suggestions
   * nobody has edited. True for a shift note, which the suggester re-reads
   * whole. False for a Pyre Agent conversation, where each suggestion is one
   * more thing the person asked for, not a fresh look at the same text.
   */
  rerunSupersedes: boolean;
}

/**
 * Whether the classifier found one of `autoSignals` in a record — by default
 * (the suggestions.autoSignals setting) an action someone should take, or a
 * record (an SOP, a list) that needs updating.
 */
export function hasAutoSuggestSignal(signals: unknown, autoSignals: readonly string[]): boolean {
  const read: Signal[] = readStoredSignals(signals);
  return read.some((s) => autoSignals.includes(s.type));
}

/** Sep 24 — the date a note is about, as people refer to it. */
export function formatMonthDay(ymd: string): string {
  const [year, month, day] = ymd.split('-').map(Number);
  if (!year || !month || !day) return ymd;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

type NoteFields = Pick<
  ShiftNoteRow,
  'id' | 'body' | 'note_date' | 'author_email' | 'status' | 'created_at'
>;

function noteRecord(note: NoteFields, names: Map<string, string>): SourceRecord {
  const email = note.author_email.trim().toLowerCase();
  const author = names.get(email);
  return {
    type: 'shift_note',
    id: note.id,
    text: note.body,
    hash: contentHash(note.body),
    label: `${author ? `${author}'s shift note` : 'Shift note'} (${formatMonthDay(note.note_date)})`,
    href: sourceHref('shift_note', note.id),
    closed: note.status === 'resolved',
    author: email || null,
    recordedAt: note.created_at,
  };
}

async function staffNames(db: SupabaseClient, emails: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (wanted.length === 0) return new Map();
  const { data } = await db.from('staff').select('email, display_name').in('email', wanted);
  const names = new Map<string, string>();
  for (const row of (data ?? []) as { email: string | null; display_name: string | null }[]) {
    const first = (row.display_name ?? '').trim().split(/\s+/)[0];
    if (row.email && first) names.set(row.email.trim().toLowerCase(), first);
  }
  return names;
}

const NOTE_COLUMNS = 'id, body, note_date, author_email, status, created_at';

interface ConversationStart {
  session_id: string;
  question: string;
  asked_by: string;
  asked_at: string;
}

/**
 * A Pyre Agent conversation, by its first session's id: the question that
 * opened it, who asked it, and when. The asker is the author, so the inbox
 * says whose conversation a suggestion came from.
 */
function conversationRecord(start: ConversationStart, names: Map<string, string>): SourceRecord {
  const email = start.asked_by.trim().toLowerCase();
  const who = names.get(email);
  return {
    type: 'pyre_agent',
    id: start.session_id,
    text: start.question,
    hash: contentHash(start.question),
    label: `${who ? `${who}'s Pyre Agent chat` : 'Pyre Agent chat'} (${formatMonthDay(start.asked_at.slice(0, 10))})`,
    href: sourceHref('pyre_agent', start.session_id),
    closed: false,
    author: email || null,
    recordedAt: start.asked_at,
  };
}

async function conversationStarts(
  db: SupabaseClient,
  ids: readonly string[]
): Promise<ConversationStart[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db
    .from('knowledge_queries')
    .select('session_id, question, asked_by, asked_at')
    .in('session_id', [...ids])
    .order('asked_at', { ascending: true });
  if (error) throw new Error(error.message);
  const first = new Map<string, ConversationStart>();
  for (const row of (data ?? []) as ConversationStart[]) {
    if (!first.has(row.session_id)) first.set(row.session_id, row);
  }
  return [...first.values()];
}

export const SUGGESTION_SOURCES: Record<SuggestionSourceType, SuggestionSource> = {
  shift_note: {
    async load(db, id) {
      const { data } = await db.from('shift_notes').select(NOTE_COLUMNS).eq('id', id).maybeSingle();
      const note = data as NoteFields | null;
      if (!note) return null;
      return noteRecord(note, await staffNames(db, [note.author_email]));
    },
    async loadMany(db, ids) {
      const out = new Map<string, SourceRecord>();
      if (ids.length === 0) return out;
      const { data, error } = await db
        .from('shift_notes')
        .select(NOTE_COLUMNS)
        .in('id', [...ids]);
      if (error) throw new Error(error.message);
      const notes = (data ?? []) as NoteFields[];
      const names = await staffNames(
        db,
        notes.map((n) => n.author_email)
      );
      for (const note of notes) out.set(note.id, noteRecord(note, names));
      return out;
    },
    autoEligible(record, signals, autoSignals) {
      return !record.closed && hasAutoSuggestSignal(signals, autoSignals);
    },
    rerunSupersedes: true,
  },
  pyre_agent: {
    async load(db, id) {
      const [start] = await conversationStarts(db, [id]);
      if (!start) return null;
      return conversationRecord(start, await staffNames(db, [start.asked_by]));
    },
    async loadMany(db, ids) {
      const out = new Map<string, SourceRecord>();
      const starts = await conversationStarts(db, ids);
      const names = await staffNames(
        db,
        starts.map((s) => s.asked_by)
      );
      for (const start of starts) out.set(start.session_id, conversationRecord(start, names));
      return out;
    },
    // Pyre Agent suggests only when asked, inside the conversation.
    autoEligible() {
      return false;
    },
    rerunSupersedes: false,
  },
};
