// What the suggester reads before proposing anything: the record itself (a
// shift note), what the classifier found in it, what has already been
// suggested for it and what the admins did with that, and the boards it can
// file work on. Read-only.

import { utcToEastern } from '@pyre/schedule-core';
import { getDb } from '../db';
import { siteUrl } from '../knowledge/urls';
import type { SuggestTarget } from '../role';

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

async function authorName(email: string): Promise<string | null> {
  const { data } = await getDb()
    .from('staff')
    .select('display_name')
    .ilike('email', email.trim())
    .maybeSingle();
  return (data as { display_name: string | null } | null)?.display_name ?? null;
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

  const [author, classification, prior, boards, columns, fields] = await Promise.all([
    authorName(note.author_email),
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
  ]);

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
      status: note.status,
      text: note.body,
      url: siteUrl(`/admin/shift-notes#note-${note.id}`),
    },
    classifierFound: (classification.data as { signals: unknown } | null)?.signals ?? [],
    priorSuggestions: ((prior.data ?? []) as Parameters<typeof priorSummary>[0][]).map(
      priorSummary
    ),
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
