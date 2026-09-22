// Lead intake: the one public door into the boards.
//
// Private rentals and group bookings are mailto links on the landing page
// today, which means a lead is only ever as reliable as somebody's inbox.
// This turns a form submission — or anything else that can make an HTTPS
// request — into a card at the top of a pipeline, without giving the caller
// a session or a way to read anything back.
//
// Deliberately narrow:
//
//   * bearer auth against BOARD_INTAKE_SECRET, the same shape the cron routes
//     use (lib/cron/auth.ts). No secret configured means no intake, not open
//     intake.
//   * it only ever creates a card in the board's first open column, never
//     moves, completes, assigns, or reads one.
//   * `externalRef` makes delivery idempotent: the same submission delivered
//     twice updates the one card and reports `created: false`. Webhooks
//     retry; a pipeline full of duplicate leads is how people stop trusting
//     one.
//   * `created_by` is the literal string 'intake' and `source` is 'intake' —
//     never anything from the request body, so a caller cannot forge
//     authorship.
//   * the board must opt in by existing and not being archived; properties
//     are normalized against its fields, so unknown keys are dropped rather
//     than stored.
//
// Trying it by hand:
//
//   curl -X POST https://<host>/api/boards/intake \
//     -H 'Authorization: Bearer $BOARD_INTAKE_SECRET' \
//     -H 'Content-Type: application/json' \
//     -d '{"board":"rentals","title":"Group of 12, Oct 3",
//          "externalRef":"web-form-8842",
//          "properties":{"contact_email":"dana@example.com","party_size":12}}'
//
//   POST { board, title, externalRef?, columnKey?, notesMd?, properties?,
//          area?, dueDate? } → { card, created }

import { defaultColumn } from '@/lib/boards/cards';
import { logBoardEvent } from '@/lib/boards/events';
import { type APIRoute, json } from '@/lib/boards/route';
import { loadBoardBySlug, loadColumns, loadFields, nextColumnOrder } from '@/lib/boards/store';
import { BOARD_LIMITS, isBoardSlug } from '@/lib/boards/types';
import { normalizeProperties, parseCardCreate } from '@/lib/boards/validate';
import type { BoardCardRow } from '@/lib/db';
import { getDb } from '@/lib/db';
import { notifyIntakeCard } from '@/lib/notifications/goals';

/** The actor on every row and every event this route writes. */
const INTAKE_ACTOR = 'intake';

function isAuthorized(request: Request): boolean {
  const secret = import.meta.env.BOARD_INTAKE_SECRET;
  if (!secret) {
    console.error('[intake] BOARD_INTAKE_SECRET not configured — rejecting all intake requests');
    return false;
  }
  return request.headers.get('Authorization') === `Bearer ${secret}`;
}

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthorized(request)) return json({ error: 'Unauthorized' }, 401);

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

  const slug = typeof body.board === 'string' ? body.board : '';
  if (!isBoardSlug(slug)) return json({ error: 'board must be a board slug' }, 400);

  const parsed = parseCardCreate(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  // An intake caller names a column by key, not by id: it has no way to know
  // an id, and the key is the part that survives a board being rebuilt.
  let columnKey: string | null = null;
  if (body.columnKey !== undefined && body.columnKey !== null && body.columnKey !== '') {
    if (typeof body.columnKey !== 'string') return json({ error: 'columnKey must be text' }, 400);
    columnKey = body.columnKey;
  }

  let externalRef: string | null = null;
  if (body.externalRef !== undefined && body.externalRef !== null && body.externalRef !== '') {
    if (typeof body.externalRef !== 'string') {
      return json({ error: 'externalRef must be text' }, 400);
    }
    externalRef = body.externalRef.trim();
    if (!externalRef || externalRef.length > BOARD_LIMITS.externalRef) {
      return json({ error: `externalRef must be 1–${BOARD_LIMITS.externalRef} characters` }, 400);
    }
  }

  const board = await loadBoardBySlug(db, slug);
  if (!board || board.archived) return json({ error: 'Board not found' }, 404);

  const columns = await loadColumns(db, board.id);
  const column = columnKey
    ? columns.find((c) => c.key === columnKey && !c.archived)
    : defaultColumn(columns);
  if (!column) return json({ error: 'That column is not on this board' }, 400);

  const fields = await loadFields(db, board.id);
  const properties = normalizeProperties(fields, body.properties);

  // The idempotent path. A re-delivery refreshes what the caller knows — a
  // corrected party size, a phone number they added — and leaves everything
  // a person has since done to the card (its column, its owner, its notes)
  // exactly where they put it.
  if (externalRef) {
    const { data: existingRow, error: existingError } = await db
      .from('board_cards')
      .select('*')
      .eq('board_id', board.id)
      .eq('external_ref', externalRef)
      .maybeSingle();
    if (existingError) return json({ error: existingError.message }, 500);

    const existing = (existingRow as BoardCardRow) ?? null;
    if (existing) {
      const { data, error } = await db
        .from('board_cards')
        .update({
          title: parsed.value.title,
          notes_md: parsed.value.notes_md || existing.notes_md,
          properties: normalizeProperties(fields, body.properties, existing.properties),
          updated_by: INTAKE_ACTOR,
        })
        .eq('id', existing.id)
        .select('*')
        .single();
      if (error) return json({ error: error.message }, 500);

      await logBoardEvent(db, {
        cardId: existing.id,
        action: 'updated',
        actor: INTAKE_ACTOR,
        detail: { external_ref: externalRef, redelivered: true },
      });
      return json({ card: data as BoardCardRow, created: false });
    }
  }

  const { data, error } = await db
    .from('board_cards')
    .insert({
      board_id: board.id,
      column_id: column.id,
      // Filed under the board's goal, like every card on it. The caller has
      // no say: a lead counts toward whatever the rental board is for.
      goal_id: board.goal_id,
      title: parsed.value.title,
      notes_md: parsed.value.notes_md,
      due_date: parsed.value.due_date,
      area: parsed.value.area,
      properties,
      sort_order: await nextColumnOrder(db, board.id, column.id),
      source: 'intake',
      external_ref: externalRef,
      created_by: INTAKE_ACTOR,
    })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  const card = data as BoardCardRow;
  await logBoardEvent(db, {
    cardId: card.id,
    action: 'created',
    actor: INTAKE_ACTOR,
    detail: externalRef ? { external_ref: externalRef } : {},
  });

  // Everyone holding this board hears. The point of routing an enquiry here
  // rather than into one person's inbox is that it stops depending on that
  // person reading their mail — but somebody still has to be told it arrived.
  await notifyIntakeCard(db, card, board);

  return json({ card, created: true }, 201);
};
