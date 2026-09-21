// The audit-trail writer for goals and cards. Every mutation in the goals and
// boards routes goes through here, so "who changed what, when" is a property
// of the system rather than something each route remembers to do.
//
// Server-only (takes a service-role client). Failures are logged and
// swallowed, the same bargain lib/incidents/log.ts makes: losing an audit
// line is bad, but failing somebody's save because the trail write failed
// would be worse, and the row is already saved by the time we get here.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { BoardEventAction, BoardEventRow } from '@/lib/db';

export interface BoardEventInput {
  /** Exactly one of these; the table's one_subject check enforces it. */
  goalId?: string | null;
  cardId?: string | null;
  action: BoardEventAction;
  /** Session email of whoever did it, or 'intake' for the public endpoint. */
  actor: string;
  detail?: Record<string, unknown>;
  note?: string | null;
}

export async function logBoardEvent(db: SupabaseClient, event: BoardEventInput): Promise<void> {
  const { error } = await db.from('board_events').insert({
    goal_id: event.goalId ?? null,
    card_id: event.cardId ?? null,
    action: event.action,
    actor: event.actor,
    detail: event.detail ?? {},
    note: event.note ?? null,
  });
  if (error) {
    console.error(`[boards] audit write failed (${event.action}):`, error.message);
  }
}

/** Several lines in one round trip — a patch that changed three things. */
export async function logBoardEvents(
  db: SupabaseClient,
  events: BoardEventInput[]
): Promise<void> {
  if (events.length === 0) return;
  const { error } = await db.from('board_events').insert(
    events.map((event) => ({
      goal_id: event.goalId ?? null,
      card_id: event.cardId ?? null,
      action: event.action,
      actor: event.actor,
      detail: event.detail ?? {},
      note: event.note ?? null,
    }))
  );
  if (error) {
    console.error('[boards] audit write failed (batch):', error.message);
  }
}

/** The full trail for one card, oldest first — how it reads as a story. */
export async function loadEventsFor(
  db: SupabaseClient,
  subject: { cardId?: string; goalId?: string }
): Promise<BoardEventRow[]> {
  let query = db.from('board_events').select('*').order('created_at', { ascending: true });
  if (subject.cardId) query = query.eq('card_id', subject.cardId);
  else if (subject.goalId) query = query.eq('goal_id', subject.goalId);
  else return [];

  const { data, error } = await query;
  if (error) {
    console.error('[boards] audit read failed:', error.message);
    return [];
  }
  return (data ?? []) as BoardEventRow[];
}

/** How many lines of history one page will show before it asks for less. */
const RECENT_LIMIT = 200;

/** Everything that happened since `sinceIso`, newest first. */
export async function loadEventsSince(
  db: SupabaseClient,
  sinceIso: string
): Promise<BoardEventRow[]> {
  const { data, error } = await db
    .from('board_events')
    .select('*')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(RECENT_LIMIT);
  if (error) {
    console.error('[boards] recent audit read failed:', error.message);
    return [];
  }
  return (data ?? []) as BoardEventRow[];
}
