// The trail and the thread. Every mechanical change a goal or a card goes
// through is written here by the routes that made it (lib/boards/events.ts);
// this route is how a page reads them back, and the one place a person can
// add a line of their own.
//
// A comment is an event with a note on it rather than a table of its own,
// because "Julien moved this to Quoted" and "Julien said the deposit cleared"
// belong in the same column of the same feed, in the order they happened.
//
//   GET ?cardId=<uuid>   → { events, people }
//   GET ?goalId=<uuid>   → { events, people }
//   GET ?since=<iso>     → { events, people }   (the recent-activity read)
//   POST { cardId? | goalId?, note } → { event } 201

import { BOARDS_HREF, GOALS_HREF, canViewPage } from '@/components/admin/adminTools';
import { canViewBoard } from '@/lib/boards/access';
import { loadEventsFor, loadEventsSince } from '@/lib/boards/events';
import {
  type APIRoute,
  type Db,
  beginMutation,
  beginRead,
  isUuidParam,
  json,
} from '@/lib/boards/route';
import { loadCard } from '@/lib/boards/store';
import { BOARD_LIMITS } from '@/lib/boards/types';
import type { BoardEventRow } from '@/lib/db';
import { getPeopleNames } from '@/lib/sops/people';

/** How far back the recent-activity read may reach in one request. */
const MAX_SINCE_DAYS = 90;

export const GET: APIRoute = async ({ cookies, url }) => {
  // Either page may read a trail: a goal page shows its own events, and a
  // board page shows a card's. The subject checks below do the narrowing.
  const ready = await beginRead(cookies, [GOALS_HREF, BOARDS_HREF]);
  if (ready instanceof Response) return ready;
  const { db, gate } = ready;

  const cardId = url.searchParams.get('cardId');
  const goalId = url.searchParams.get('goalId');
  const since = url.searchParams.get('since');

  let events: BoardEventRow[];
  if (cardId) {
    if (!isUuidParam(cardId)) return json({ error: 'cardId must be a UUID' }, 400);
    const refused = await refuseUnreadableCard(db, cardId, gate.access);
    if (refused) return refused;
    events = await loadEventsFor(db, { cardId });
  } else if (goalId) {
    if (!isUuidParam(goalId)) return json({ error: 'goalId must be a UUID' }, 400);
    // A goal's trail belongs to the goals page. Holding one board is not a
    // way to read what the founders have been deciding.
    if (!canViewPage(gate.access, GOALS_HREF)) return json({ error: 'Goal not found' }, 404);
    events = await loadEventsFor(db, { goalId });
  } else if (since) {
    // The firehose read spans every board and every goal, so it is the goals
    // page's alone.
    if (!canViewPage(gate.access, GOALS_HREF)) return json({ error: 'Forbidden' }, 403);
    const parsed = Date.parse(since);
    if (Number.isNaN(parsed)) return json({ error: 'since must be an ISO timestamp' }, 400);
    const floor = Date.now() - MAX_SINCE_DAYS * 86_400_000;
    events = await loadEventsSince(db, new Date(Math.max(parsed, floor)).toISOString());
  } else {
    return json({ error: 'Pass cardId, goalId, or since' }, 400);
  }

  return json({ events, people: await getPeopleNames(events.map((event) => event.actor)) });
};

export const POST: APIRoute = async ({ cookies, request }) => {
  // Either page gets you in the door; which subject you may comment on is
  // decided below — a card by the board it sits on, a goal by the goals page.
  const ready = await beginMutation(cookies, request, [GOALS_HREF, BOARDS_HREF]);
  if (ready instanceof Response) return ready;
  const { db, email, body, gate } = ready;

  const cardId = typeof body.cardId === 'string' ? body.cardId : null;
  const goalId = typeof body.goalId === 'string' ? body.goalId : null;
  if ((cardId === null) === (goalId === null)) {
    return json({ error: 'Pass exactly one of cardId or goalId' }, 400);
  }

  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (!note) return json({ error: 'note must be non-empty text' }, 400);
  if (note.length > BOARD_LIMITS.comment) {
    return json({ error: `note must be ${BOARD_LIMITS.comment} characters or fewer` }, 400);
  }

  if (cardId) {
    if (!isUuidParam(cardId)) return json({ error: 'cardId must be a UUID' }, 400);
    const refused = await refuseUnreadableCard(db, cardId, gate.access);
    if (refused) return refused;
  } else if (goalId) {
    if (!isUuidParam(goalId)) return json({ error: 'goalId must be a UUID' }, 400);
    // A goal's thread is the goals page's, not any board holder's.
    if (!canViewPage(gate.access, GOALS_HREF)) return json({ error: 'Goal not found' }, 404);
    const { data } = await db.from('goals').select('id').eq('id', goalId).maybeSingle();
    if (!data) return json({ error: 'Goal not found' }, 404);
  }

  // Unlike every other write here, a comment is the payload rather than a
  // side effect, so this one is inserted directly: a swallowed failure would
  // lose what somebody typed.
  const { data, error } = await db
    .from('board_events')
    .insert({
      card_id: cardId,
      goal_id: goalId,
      action: 'comment',
      actor: email,
      detail: {},
      note,
    })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ event: data as BoardEventRow }, 201);
};

/** 404 unless this access opens the board the card is on. */
async function refuseUnreadableCard(
  db: Db,
  cardId: string,
  access: { isAdmin: boolean; pages: string[] }
): Promise<Response | null> {
  const card = await loadCard(db, cardId);
  if (!card) return json({ error: 'Card not found' }, 404);
  const { data } = await db.from('boards').select('slug').eq('id', card.board_id).maybeSingle();
  const slug = (data as { slug: string } | null)?.slug;
  if (!slug || !canViewBoard(access, slug)) return json({ error: 'Card not found' }, 404);
  return null;
}
