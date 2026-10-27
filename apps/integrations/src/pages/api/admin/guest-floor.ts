// On the floor — check-in times behind /admin/guests/floor.
//   GET                                          — today's sessions in the
//                                                  window and everyone booked
//                                                  into them, with check-in
//                                                  times (lib/guests/floor.ts)
//   POST   { sessionId, bookingId }              — check in now: Momence's
//                                                  check-in, plus the time
//   PATCH  { sessionId, bookingId, checkedInAt?,
//            minutes?, warned? }                 — correct the time, set a
//                                                  different length, mark the
//                                                  15-minute warning given
//   DELETE ?sessionId=&bookingId=                — undo a check-in, in
//                                                  Momence and here
//
// Gated on the guests page, like Who's coming. Every mutation re-reads the
// booking from Momence, so a request can only touch a live booking on a
// session in today's window. Momence refusing the check-in still starts the
// timer: the guest is here either way, and the response says to check them
// in there by hand.

import type { APIRoute } from 'astro';
import { requirePage } from '@/lib/auth/admin';
import type { GuestFloorCheckinRow } from '@/lib/db';
import { getDb } from '@/lib/db';
import { findFloorBooking, loadFloor } from '@/lib/guests/floor';
import { GUESTS_PAGE } from '@/lib/guests/types';
import { beginDelete, beginMutation, dbError, json } from '@/lib/http/route';
import { bookingMember, setSessionBookingCheckIn } from '@/lib/momence/host-api';

export const prerender = false;

const ID_RE = /^\d{1,20}$/;
/** A corrected check-in can't be in the future, or before the day started. */
const MAX_CHECKIN_AGE_MS = 12 * 60 * 60_000;
const CLOCK_SKEW_MS = 60_000;

function ids(source: Record<string, unknown> | URLSearchParams) {
  const get = (key: string) => (source instanceof URLSearchParams ? source.get(key) : source[key]);
  const sessionId = String(get('sessionId') ?? '');
  const bookingId = String(get('bookingId') ?? '');
  return ID_RE.test(sessionId) && ID_RE.test(bookingId) ? { sessionId, bookingId } : null;
}

const unreachable = () =>
  json({ error: "Momence is unreachable — can't confirm that booking." }, 502);
const notOnFloor = () => json({ error: "That booking isn't on today's floor." }, 404);

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requirePage(cookies, GUESTS_PAGE);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const now = Date.now();
  try {
    const floor = await loadFloor(db, now);
    return json({ available: true, now: new Date(now).toISOString(), ...floor });
  } catch (e) {
    console.error('[guests/floor] load failed:', e instanceof Error ? e.message : e);
    return json({
      available: false,
      now: new Date(now).toISOString(),
      sessions: [],
      guests: [],
      complete: false,
      error: "Momence is unreachable — can't see who is checked in.",
    });
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, GUESTS_PAGE);
  if (ready instanceof Response) return ready;
  const { db, email, body } = ready;

  const target = ids(body);
  if (!target) return json({ error: 'sessionId and bookingId must be numeric' }, 400);

  const now = Date.now();
  let found: Awaited<ReturnType<typeof findFloorBooking>>;
  try {
    found = await findFloorBooking(target.sessionId, target.bookingId, now);
  } catch {
    return unreachable();
  }
  if (!found) return notOnFloor();

  let momenceSynced = true;
  try {
    await setSessionBookingCheckIn(Number(target.bookingId), true);
  } catch (e) {
    momenceSynced = false;
    console.error('[guests/floor] Momence check-in failed:', e instanceof Error ? e.message : e);
  }

  const { data, error } = await db
    .from('guest_floor_checkins')
    .upsert(
      {
        booking_id: target.bookingId,
        session_id: target.sessionId,
        member_id: bookingMember(found.booking)?.memberId || null,
        checked_in_at: new Date(now).toISOString(),
        session_minutes: null,
        warned_at: null,
        warned_by: null,
        updated_by: email,
        updated_at: new Date(now).toISOString(),
      },
      { onConflict: 'booking_id' }
    )
    .select('*')
    .single();
  if (error) return dbError(error);

  return json({ checkin: data as GuestFloorCheckinRow, momenceSynced }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, GUESTS_PAGE);
  if (ready instanceof Response) return ready;
  const { db, email, body } = ready;

  const target = ids(body);
  if (!target) return json({ error: 'sessionId and bookingId must be numeric' }, 400);

  const now = Date.now();
  const changes: Partial<GuestFloorCheckinRow> = {};

  if (body.checkedInAt !== undefined) {
    const at = typeof body.checkedInAt === 'string' ? Date.parse(body.checkedInAt) : Number.NaN;
    if (!Number.isFinite(at) || at > now + CLOCK_SKEW_MS || at < now - MAX_CHECKIN_AGE_MS) {
      return json({ error: 'checkedInAt must be a time in the last 12 hours' }, 400);
    }
    changes.checked_in_at = new Date(at).toISOString();
  }
  if (body.minutes !== undefined) {
    const minutes = body.minutes;
    if (
      minutes !== null &&
      (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 5 || minutes > 600)
    ) {
      return json({ error: 'minutes must be a whole number from 5 to 600, or null' }, 400);
    }
    changes.session_minutes = minutes;
  }
  if (body.warned !== undefined) {
    if (typeof body.warned !== 'boolean')
      return json({ error: 'warned must be true or false' }, 400);
    changes.warned_at = body.warned ? new Date(now).toISOString() : null;
    changes.warned_by = body.warned ? email : null;
  }
  if (Object.keys(changes).length === 0) return json({ error: 'Nothing to change' }, 400);

  let found: Awaited<ReturnType<typeof findFloorBooking>>;
  try {
    found = await findFloorBooking(target.sessionId, target.bookingId, now);
  } catch {
    return unreachable();
  }
  if (!found) return notOnFloor();

  const { data: existing, error: readError } = await db
    .from('guest_floor_checkins')
    .select('*')
    .eq('booking_id', target.bookingId)
    .maybeSingle();
  if (readError) return dbError(readError);

  // A guest checked in at the desk has no row yet. The page shows them with
  // an estimated time and sends it along, so editing anything else keeps the
  // time they were seeing.
  if (!existing && !changes.checked_in_at) {
    if (!found.booking.checkedIn) return json({ error: 'Check them in first' }, 409);
    return json({ error: 'checkedInAt is required for a guest checked in elsewhere' }, 400);
  }

  const { data, error } = await db
    .from('guest_floor_checkins')
    .upsert(
      {
        ...((existing as GuestFloorCheckinRow | null) ?? {
          booking_id: target.bookingId,
          session_id: target.sessionId,
          member_id: bookingMember(found.booking)?.memberId || null,
        }),
        ...changes,
        updated_by: email,
        updated_at: new Date(now).toISOString(),
      },
      { onConflict: 'booking_id' }
    )
    .select('*')
    .single();
  if (error) return dbError(error);

  return json({ checkin: data as GuestFloorCheckinRow });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const ready = await beginDelete(cookies, request, GUESTS_PAGE);
  if (ready instanceof Response) return ready;
  const { db } = ready;

  const target = ids(url.searchParams);
  if (!target) return json({ error: 'sessionId and bookingId must be numeric' }, 400);

  let found: Awaited<ReturnType<typeof findFloorBooking>>;
  try {
    found = await findFloorBooking(target.sessionId, target.bookingId, Date.now());
  } catch {
    return unreachable();
  }
  if (!found) return notOnFloor();

  if (found.booking.checkedIn) {
    try {
      await setSessionBookingCheckIn(Number(target.bookingId), false);
    } catch (e) {
      console.error('[guests/floor] Momence undo failed:', e instanceof Error ? e.message : e);
      return json({ error: "Momence wouldn't undo the check-in — nothing changed." }, 502);
    }
  }

  const { error } = await db
    .from('guest_floor_checkins')
    .delete()
    .eq('booking_id', target.bookingId);
  if (error) return dbError(error);

  return json({ ok: true });
};
