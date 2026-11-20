// What the suggester reads before proposing anything: the record itself (a
// shift note) and the replies in its thread, the active roster (to name who
// a task is for), what the classifier found in it, what has already been
// suggested for it and what the admins did with that, and the boards it can
// file work on. Read-only.

import { utcToEastern } from '@pyre/schedule-core';
import { getDb } from '../db';
import { siteUrl } from '../knowledge/urls';
import type { SuggestTarget } from '../role';
import { inventoryForContext } from './inventory';

/** The board new work lands on when no other board fits: the Tasks board. */
export const DEFAULT_BOARD_SLUG = 'goals';

type Source = NonNullable<SuggestTarget['source']>;

interface NoteRow {
  id: string;
  note_date: string;
  body: string;
  author_email: string;
  status: string;
}

interface ReplyRow {
  id: string;
  body: string;
  author_email: string | null;
  is_private: boolean;
  created_at: string;
  updated_at: string;
}

interface StaffRow {
  email: string | null;
  display_name: string | null;
  is_admin: boolean | null;
}

/** Names (and whether each is an admin) for the note's author and everyone who replied. */
async function staffByEmail(emails: string[]): Promise<Map<string, StaffRow>> {
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const out = new Map<string, StaffRow>();
  if (wanted.length === 0) return out;
  const { data } = await getDb()
    .from('staff')
    .select('email, display_name, is_admin')
    .in('email', wanted);
  for (const row of (data ?? []) as StaffRow[]) {
    if (row.email) out.set(row.email.trim().toLowerCase(), row);
  }
  return out;
}

/**
 * The thread under a note, as the suggester reads it: the comments people
 * wrote, oldest first — an admin answering a question the note asked, the
 * author adding a number they forgot. The app's own events (status changes,
 * edits, the classifier's reads) are history, not something anyone said, and
 * stay out. Private replies are in: they are admin-only, and so is every
 * suggestion.
 */
/** The active roster as the suggester names people: display name and email. */
export function shapeRoster(rows: readonly { display_name: string | null; email: string | null }[]) {
  return rows
    .filter((r): r is { display_name: string | null; email: string } => Boolean(r.email?.trim()))
    .map((r) => ({
      name: r.display_name?.trim() || r.email.trim().toLowerCase(),
      email: r.email.trim().toLowerCase(),
    }));
}

export function shapeReplies(rows: readonly ReplyRow[], staff: Map<string, StaffRow>) {
  return rows.map((row) => {
    const email = (row.author_email ?? '').trim().toLowerCase();
    const person = staff.get(email);
    return {
      replyId: row.id,
      author: person?.display_name ?? 'a staff member',
      authorEmail: email,
      fromAdmin: person?.is_admin === true,
      at: row.created_at,
      ...(row.updated_at !== row.created_at ? { editedAt: row.updated_at } : {}),
      ...(row.is_private ? { private: true } : {}),
      text: row.body,
    };
  });
}

/** A prior suggestion, as the agent needs to see it: what it was, and what happened to it. */
function priorSummary(row: {
  kind: string;
  status: string;
  payload: Record<string, unknown>;
  edited_payload: Record<string, unknown> | null;
  decision_note: string | null;
  created_at: string;
}) {
  const payload = row.edited_payload ?? row.payload;
  const what =
    row.kind === 'board_card.create'
      ? `new card "${String(payload.title ?? '')}" on ${String(payload.board ?? '')}`
      : row.kind === 'board_card.comment'
        ? `comment on card ${String(payload.cardId ?? '')}: ${String(payload.note ?? '').slice(0, 200)}`
        : row.kind === 'shift_assignment.update'
          ? `hours for ${String(payload.staffName ?? '')} on ${String(payload.shiftLabel ?? '')} ${String(payload.shiftDate ?? '')} (assignment ${String(payload.assignmentId ?? '')}): ${String(payload.startsAt ?? '')}–${String(payload.endsAt ?? '')}`
          : row.kind === 'inventory.count'
            ? `inventory count for ${String(payload.itemName ?? '')} (item ${String(payload.itemId ?? '')}): ${payload.change == null ? `${String(payload.inStock ?? '')} in stock` : `change of ${String(payload.change)}`}`
            : row.kind === 'inventory.create'
              ? `new inventory item "${String(payload.name ?? '')}"${payload.inStock == null ? '' : `, ${String(payload.inStock)} in stock`}`
              : `edit to SOP ${String(payload.slug ?? '')}: ${String(payload.changeNote ?? '')}`;
  return {
    kind: row.kind,
    status: row.status,
    what,
    ...(row.decision_note ? { adminNote: row.decision_note } : {}),
    suggestedAt: row.created_at.slice(0, 10),
  };
}

export async function getSuggestionContext(source: Source) {
  const db = getDb();
  const { data: noteData, error } = await db
    .from('shift_notes')
    .select('id, note_date, body, author_email, status')
    .eq('id', source.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const note = noteData as NoteRow | null;
  if (!note) {
    return { found: false as const, error: 'The shift note no longer exists. Save an empty list.' };
  }

  const [replies, roster, classification, prior, boards, columns, fields, inventory] =
    await Promise.all([
    db
      .from('shift_note_replies')
      .select('id, body, author_email, is_private, created_at, updated_at')
      .eq('note_id', note.id)
      .eq('kind', 'comment')
      .order('created_at', { ascending: true }),
    db
      .from('staff')
      .select('display_name, email')
      .eq('active', true)
      .not('email', 'is', null)
      .order('display_name'),
    db
      .from('content_classifications')
      .select('signals')
      .eq('subject_type', source.type)
      .eq('subject_id', source.id)
      .maybeSingle(),
    db
      .from('agent_suggestions')
      .select('kind, status, payload, edited_payload, decision_note, created_at')
      .eq('source_type', source.type)
      .eq('source_id', source.id)
      .neq('status', 'superseded')
      .order('created_at', { ascending: true }),
    db
      .from('boards')
      .select('id, slug, name, description, card_noun')
      .eq('archived', false)
      .order('sort_order'),
    db
      .from('board_columns')
      .select('board_id, key, label, kind')
      .eq('archived', false)
      .eq('kind', 'open')
      .order('sort_order'),
    db
      .from('board_fields')
      .select('board_id, key, label, kind, options, hint')
      .eq('archived', false)
      .neq('kind', 'files')
      .order('sort_order'),
    inventoryForContext().catch(() => ({
      complete: false as const,
      note: 'The inventory could not be read here; find items with find_inventory_items.',
    })),
  ]);

  const replyRows = (replies.data ?? []) as ReplyRow[];
  const staff = await staffByEmail([
    note.author_email,
    ...replyRows.map((r) => r.author_email ?? ''),
  ]);
  const author = staff.get(note.author_email.trim().toLowerCase())?.display_name ?? null;

  const boardRows = (boards.data ?? []) as {
    id: string;
    slug: string;
    name: string;
    description: string;
    card_noun: string;
  }[];
  const columnRows = (columns.data ?? []) as { board_id: string; key: string; label: string }[];
  const fieldRows = (fields.data ?? []) as {
    board_id: string;
    key: string;
    label: string;
    kind: string;
    options: string[];
    hint: string | null;
  }[];

  return {
    found: true as const,
    today: utcToEastern(new Date().toISOString()).date,
    note: {
      date: note.note_date,
      author: author ?? 'a staff member',
      authorEmail: note.author_email,
      status: note.status,
      text: note.body,
      url: siteUrl(`/admin/shift-notes#note-${note.id}`),
      // The conversation under the note, oldest first. Read it with the note:
      // a reply can answer what the note asked, or correct what it said.
      replies: shapeReplies(replyRows, staff),
    },
    // Who a new task can be put on, when the note or a reply says who should
    // do it: names and emails only.
    staff: shapeRoster((roster.data ?? []) as { display_name: string | null; email: string | null }[]),
    classifierFound: (classification.data as { signals: unknown } | null)?.signals ?? [],
    priorSuggestions: ((prior.data ?? []) as Parameters<typeof priorSummary>[0][]).map(
      priorSummary
    ),
    // The whole active inventory (or a note to search it, when it is large):
    // a count is matched against this list, not guessed.
    inventory,
    defaultBoard: DEFAULT_BOARD_SLUG,
    boards: boardRows.map((board) => ({
      slug: board.slug,
      name: board.name,
      description: board.description,
      cardNoun: board.card_noun,
      openColumns: columnRows
        .filter((c) => c.board_id === board.id)
        .map((c) => ({ key: c.key, label: c.label })),
      fields: fieldRows
        .filter((f) => f.board_id === board.id)
        .map((f) => ({
          key: f.key,
          label: f.label,
          kind: f.kind,
          ...(f.options.length > 0 ? { options: f.options } : {}),
          ...(f.hint ? { hint: f.hint } : {}),
        })),
    })),
  };
}
