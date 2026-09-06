// "Who is coming to this session?" — the roster behind /admin/guests/sessions.
//
// Momence knows who booked; we know what they like. This module joins the
// two: the day's sessions from the cached schedule feed, one session's
// booking list, and for each person on it their profile (summary, the
// answers flagged for the roster, the latest note) plus the Momence facts
// worth knowing before they walk in (first visit, member or pack, visit
// count). Everything Momence-side is best-effort: a person we can't enrich
// still appears, just with less next to their name.

import { utcToEastern } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GuestProfileFieldRow, GuestProfileNoteRow, GuestProfileRow } from '@/lib/db';
import {
  bookingMember,
  fetchHostMember,
  fetchMemberActivePacks,
  fetchSessionBookings,
  type HostSession,
} from '@/lib/momence/host-api';
import { fetchScheduleFeed } from '@/lib/schedule/signups';
import { type MembershipStanding, membershipStanding, summarizePack } from './insights';
import { type Highlight, rosterHighlights } from './types';

/** One session on the day's list. */
export interface RosterSession {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  /** Live bookings, net of cancellations, as Momence counts them. */
  bookingCount: number;
  capacity: number | null;
}

/** One person on a session's roster, with everything we could learn. */
export interface RosterGuest {
  memberId: string;
  name: string;
  email: string;
  checkedIn: boolean;
  /** Seats they hold — a guest bringing a friend books two. */
  seats: number;
  /** Momence's counter of attended visits before today; null = not enriched. */
  visitsAttended: number | null;
  /** True when Momence has never checked them in — greet them as new. */
  firstVisit: boolean | null;
  standing: MembershipStanding | null;
  tags: string[];
  /** Our profile, when one exists. */
  profileId: string | null;
  summary: string | null;
  highlights: Highlight[];
  latestNote: { body: string; author: string; at: string } | null;
}

export interface SessionRoster {
  session: RosterSession;
  guests: RosterGuest[];
  /**
   * False when Momence returned bookings but none carried a customer we
   * could resolve — "we can't see who is coming" reads differently from
   * "nobody is coming".
   */
  identityAvailable: boolean;
  /** Whether the Momence per-person lookups ran to completion. */
  enriched: boolean;
}

function summarizeSession(session: HostSession): RosterSession {
  return {
    id: String(session.id),
    name: session.name,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    bookingCount: session.bookingCount ?? 0,
    capacity: session.capacity ?? null,
  };
}

/** The sessions on one ET calendar day, earliest first. */
export async function sessionsOnDate(date: string): Promise<RosterSession[]> {
  const feed = await fetchScheduleFeed(date, date);
  return feed.sessions
    .filter((s) => utcToEastern(s.startsAt).date === date)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map(summarizeSession);
}

/** Booked people on one session, de-duplicated, before any enrichment. */
export interface BookedPerson {
  memberId: string;
  name: string;
  email: string;
  checkedIn: boolean;
  seats: number;
}

/**
 * Collapse booking rows to people. A member id is the join key when there is
 * one; a booking that carries only an email is still a person. Cancelled
 * seats are dropped; two seats under one person count once, as attending if
 * either was checked in.
 */
export function collapseBookings(bookings: Awaited<ReturnType<typeof fetchSessionBookings>>): {
  people: BookedPerson[];
  identityAvailable: boolean;
} {
  const live = bookings.filter((b) => !b.cancelledAt);
  const byKey = new Map<string, BookedPerson>();
  let resolved = 0;

  for (const booking of live) {
    const person = bookingMember(booking);
    if (!person) continue;
    resolved += 1;
    const key = person.memberId ? `m:${person.memberId}` : `e:${person.email}`;
    const seats = Math.max(1, booking.ticketsBought || 1);
    const existing = byKey.get(key);
    if (existing) {
      existing.seats += seats;
      existing.checkedIn = existing.checkedIn || booking.checkedIn;
      if (!existing.name && person.name) existing.name = person.name;
      if (!existing.email && person.email) existing.email = person.email;
      continue;
    }
    byKey.set(key, {
      memberId: person.memberId,
      name: person.name,
      email: person.email,
      checkedIn: booking.checkedIn,
      seats,
    });
  }

  return {
    people: [...byKey.values()],
    identityAvailable: live.length === 0 || resolved > 0,
  };
}

/** Profiles keyed both ways, so a booking with only an email still matches. */
export function indexProfiles(profiles: GuestProfileRow[]): {
  byMemberId: Map<string, GuestProfileRow>;
  byEmail: Map<string, GuestProfileRow>;
} {
  const byMemberId = new Map<string, GuestProfileRow>();
  const byEmail = new Map<string, GuestProfileRow>();
  for (const profile of profiles) {
    byMemberId.set(profile.momence_member_id, profile);
    if (profile.email) byEmail.set(profile.email.toLowerCase(), profile);
  }
  return { byMemberId, byEmail };
}

/** Run `work` over `items` a few at a time, stopping at the deadline. */
async function mapWithBudget<T, R>(
  items: T[],
  concurrency: number,
  deadlineMs: number,
  work: (item: T) => Promise<R>
): Promise<{ results: (R | null)[]; complete: boolean }> {
  const results: (R | null)[] = items.map(() => null);
  let next = 0;
  let complete = true;

  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      if (Date.now() > deadlineMs) {
        complete = false;
        return;
      }
      try {
        results[index] = await work(items[index]);
      } catch {
        results[index] = null;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { results, complete };
}

interface Enrichment {
  visitsAttended: number;
  standing: MembershipStanding;
  tags: string[];
  name: string;
  email: string;
}

async function enrich(memberId: string): Promise<Enrichment> {
  const id = Number(memberId);
  const [member, packs] = await Promise.all([
    fetchHostMember(id),
    // The 20h cache is fine here: a pack bought at the desk today still
    // reads as "on a pack" on tomorrow's roster, and the profile page has
    // a refresh button for the impatient.
    fetchMemberActivePacks(id).catch(() => []),
  ]);
  return {
    visitsAttended: member.visits?.totalVisits ?? 0,
    standing: membershipStanding(packs.map(summarizePack)),
    tags: (member.customerTags ?? []).map((t) => t.name),
    name: [member.firstName, member.lastName].filter(Boolean).join(' ').trim(),
    email: (member.email ?? '').trim().toLowerCase(),
  };
}

/** Roughly how long the roster route may spend on per-person lookups. */
const ENRICH_BUDGET_MS = 12_000;
const ENRICH_CONCURRENCY = 4;

/**
 * The full roster for one session. `session` comes from sessionsOnDate (the
 * route looks it up by id) so the response can carry its name and time
 * without a second Momence call.
 */
export async function rosterForSession(
  db: SupabaseClient,
  session: RosterSession,
  fields: GuestProfileFieldRow[]
): Promise<SessionRoster> {
  const bookings = await fetchSessionBookings(Number(session.id));
  const { people, identityAvailable } = collapseBookings(bookings);

  // Our side first: profiles for everyone booked, by member id or email.
  const memberIds = people.map((p) => p.memberId).filter(Boolean);
  const emails = people.map((p) => p.email).filter(Boolean);
  const profiles: GuestProfileRow[] = [];
  if (memberIds.length > 0) {
    const { data } = await db.from('guest_profiles').select('*').in('momence_member_id', memberIds);
    profiles.push(...((data ?? []) as GuestProfileRow[]));
  }
  if (emails.length > 0) {
    const known = new Set(profiles.map((p) => p.id));
    const { data } = await db.from('guest_profiles').select('*').in('email', emails);
    for (const row of (data ?? []) as GuestProfileRow[]) {
      if (!known.has(row.id)) profiles.push(row);
    }
  }
  const { byMemberId, byEmail } = indexProfiles(profiles);

  // Latest note per profile, in one query.
  const latestNotes = new Map<string, GuestProfileNoteRow>();
  if (profiles.length > 0) {
    const { data } = await db
      .from('guest_profile_notes')
      .select('*')
      .in(
        'profile_id',
        profiles.map((p) => p.id)
      )
      .order('created_at', { ascending: false });
    for (const note of (data ?? []) as GuestProfileNoteRow[]) {
      if (!latestNotes.has(note.profile_id)) latestNotes.set(note.profile_id, note);
    }
  }

  // Then Momence, a few people at a time, inside a budget.
  const deadline = Date.now() + ENRICH_BUDGET_MS;
  const { results, complete } = await mapWithBudget(
    people,
    ENRICH_CONCURRENCY,
    deadline,
    (person) => (person.memberId ? enrich(person.memberId) : Promise.resolve(null))
  );

  const guests: RosterGuest[] = people.map((person, index) => {
    const extra = results[index];
    const profile =
      (person.memberId ? byMemberId.get(person.memberId) : undefined) ??
      (person.email ? byEmail.get(person.email) : undefined) ??
      null;
    const note = profile ? (latestNotes.get(profile.id) ?? null) : null;
    return {
      memberId: person.memberId,
      name: person.name || extra?.name || profile?.name || person.email,
      email: person.email || extra?.email || profile?.email || '',
      checkedIn: person.checkedIn,
      seats: person.seats,
      visitsAttended: extra ? extra.visitsAttended : null,
      // Checked in today already counts as a visit in Momence's counter, so
      // "first visit" is "no visits other than possibly this one".
      firstVisit: extra ? extra.visitsAttended <= (person.checkedIn ? 1 : 0) : null,
      standing: extra ? extra.standing : null,
      tags: extra?.tags ?? [],
      profileId: profile?.id ?? null,
      summary: profile?.summary ?? null,
      highlights: profile ? rosterHighlights(fields, profile.field_values) : [],
      latestNote: note ? { body: note.body, author: note.author_email, at: note.created_at } : null,
    };
  });

  // First-timers first — they are the ones to greet by name — then by name.
  guests.sort((a, b) => {
    const firstA = a.firstVisit ? 0 : 1;
    const firstB = b.firstVisit ? 0 : 1;
    return firstA - firstB || a.name.localeCompare(b.name);
  });

  return { session, guests, identityAvailable, enriched: complete };
}
