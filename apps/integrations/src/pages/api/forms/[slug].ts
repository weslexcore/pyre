// A form submission becoming a card. The public door for a board that has
// opened one, and the staff door for a board that has not.
//
// Not under /api/admin, so it gates itself, and how depends on the form:
//
//   * public — no session. A honeypot, a clock, and a per-address counter
//     (lib/boards/form-guard.ts) stand in for one. The actor on the card
//     and its trail is the literal string 'form'; nothing in the body can
//     name who wrote it.
//   * admin — a session cookie, same-origin, and a grant that can view the
//     board, exactly what the board page itself asks for. The actor is the
//     session email, so the trail reads like any card they made by hand.
//
// Either way it only ever creates a card, in the board's first open column,
// shaped by parseSubmission against the form as it is asked today. It never
// moves, completes, assigns, or reads one back.
//
//   POST { answers: { <question id>: <answer> }, startedAt?, website? }
//     → 201 { ok: true, confirmation, confetti }
//     → 400 (a required answer missing, or too fast), 404, 410 (closed),
//       429 (too many from one address)

import { getAccess } from '@/lib/auth/access';
import { assertSameOrigin } from '@/lib/auth/admin';
import { validateSession } from '@/lib/auth/session';
import { canViewBoard } from '@/lib/boards/access';
import { filterFileAnswers, syncCardAttachments } from '@/lib/boards/card-media';
import { defaultColumn } from '@/lib/boards/cards';
import { logBoardEvent } from '@/lib/boards/events';
import {
  clientIp,
  FORM_RATE,
  honeypotTripped,
  isRateLimited,
  rateKey,
  refundRateLimit,
  tooFast,
} from '@/lib/boards/form-guard';
import { formConfigOf, parseSubmission } from '@/lib/boards/forms';
import { type APIRoute, json } from '@/lib/boards/route';
import {
  loadBoardBySlug,
  loadColumns,
  loadFields,
  loadForm,
  nextColumnOrder,
} from '@/lib/boards/store';
import { isBoardSlug } from '@/lib/boards/types';
import type { BoardCardRow } from '@/lib/db';
import { getDb } from '@/lib/db';
import { notifyIntakeCard } from '@/lib/notifications/goals';

/** The actor on a public submission's card and trail. */
const FORM_ACTOR = 'form';

export const POST: APIRoute = async ({ params, request, cookies, clientAddress }) => {
  const slug = params.slug;
  if (!isBoardSlug(slug)) return json({ error: 'Form not found' }, 404);

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
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    const board = await loadBoardBySlug(db, slug);
    if (!board || board.archived) return json({ error: 'Form not found' }, 404);
    const row = await loadForm(db, board.id);
    if (!row) return json({ error: 'Form not found' }, 404);
    if (!row.enabled) return json({ error: 'This form is closed' }, 410);
    const form = formConfigOf(row);

    let actor: string;
    let limitKey: string | null = null;
    if (form.access === 'public') {
      // A bot that filled the hidden field learns nothing from a 200.
      if (honeypotTripped(body)) return json({ ok: true, confirmation: form.confirmation });
      if (tooFast(body.startedAt)) {
        return json({ error: 'Please take a moment and try again' }, 400);
      }
      limitKey = rateKey(clientIp(request, () => clientAddress));
      if (await isRateLimited(limitKey, FORM_RATE.limit, FORM_RATE.windowSeconds)) {
        return json({ error: 'Too many submissions from this address. Try again later.' }, 429);
      }
      actor = FORM_ACTOR;
    } else {
      const crossOrigin = assertSameOrigin(request);
      if (crossOrigin) return crossOrigin;
      const { session } = await validateSession(cookies);
      // A cutover (Momence) session hasn't set a password yet — treat it as
      // signed out, so the login page routes it to /set-password.
      const email =
        session.isAuthenticated && session.source === 'supabase'
          ? (session.user?.email ?? '').trim().toLowerCase()
          : '';
      if (!email) return json({ error: 'Sign in to send this form' }, 401);
      const access = await getAccess(email);
      // Not-found and not-yours look the same, as on the board routes.
      if (!access || !canViewBoard(access, slug)) return json({ error: 'Form not found' }, 404);
      actor = email;
    }

    const [fields, columns] = await Promise.all([
      loadFields(db, board.id),
      loadColumns(db, board.id),
    ]);
    const column = defaultColumn(columns);
    if (!column) return json({ error: 'This board has nowhere to put a new card' }, 400);

    const parsed = parseSubmission(form, fields, body, `New ${board.card_noun}`);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    // A file id the form's own upload route did not stage on this board
    // names nothing the card may list, and is dropped here.
    const properties = await filterFileAnswers(db, board.id, null, fields, parsed.value.properties);

    const { data, error } = await db
      .from('board_cards')
      .insert({
        board_id: board.id,
        column_id: column.id,
        goal_id: board.goal_id,
        title: parsed.value.title,
        notes_md: parsed.value.notes_md,
        due_date: parsed.value.due_date,
        properties,
        sort_order: await nextColumnOrder(db, board.id, column.id),
        source: 'form',
        created_by: actor,
      })
      .select('*')
      .single();
    if (error) {
      // Our failure should not count against the sender.
      if (limitKey) await refundRateLimit(limitKey);
      return json({ error: error.message }, 500);
    }

    const card = data as BoardCardRow;
    await syncCardAttachments(db, card.id, fields, {}, card.properties);
    await logBoardEvent(db, {
      cardId: card.id,
      action: 'created',
      actor,
      detail: { form: true, access: form.access },
    });
    await notifyIntakeCard(db, card, board, 'the form', form.notify);

    return json({ ok: true, confirmation: form.confirmation, confetti: form.confetti }, 201);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[forms] submission failed:', message);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
};
