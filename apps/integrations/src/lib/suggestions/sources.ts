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
export function shortDate(ymd: string): string {
  const [year, month, day] = ymd.split('-').map(Number);
  if (!year || !month || !day) return ymd;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

type NoteFields = Pick<ShiftNoteRow, 'id' | 'body' | 'note_date' | 'author_email' | 'status'>;

function noteRecord(note: NoteFields, names: Map<string, string>): SourceRecord {
  const author = names.get(note.author_email.trim().toLowerCase());
  return {
    type: 'shift_note',
    id: note.id,
    text: note.body,
    hash: contentHash(note.body),
    label: `${author ? `${author}'s shift note` : 'Shift note'} (${shortDate(note.note_date)})`,
    href: sourceHref('shift_note', note.id),
    closed: note.status === 'resolved',
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

const NOTE_COLUMNS = 'id, body, note_date, author_email, status';

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
  },
};
