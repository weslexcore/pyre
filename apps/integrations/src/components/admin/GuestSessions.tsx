// Who's coming (/admin/guests/sessions).
//
// A day's sessions from Momence, and for whichever one is open, everyone
// booked into it with what we know: first visit or regular, member or pack,
// the preferences flagged for the roster, the latest note. Built for the
// half hour before a session, on a phone, so the roster leads with the
// people to greet by name.

import { useMemo, useState } from 'react';
import { useCachedJson } from '@/lib/client/cachedJson';
import { timeAgo } from '@/lib/client/relativeTime';
import type { RosterSession, SessionRoster } from '@/lib/guests/roster';
import { firstNameOf } from '@/lib/guests/types';
import { type PeopleNames, personName } from '@/lib/sops/names';
import {
  AnswerPill,
  CheckedInBadge,
  FirstVisitBadge,
  formatDateLabel,
  formatTimeRange,
  QuietBadge,
  StandingBadge,
  shiftDate,
  todayEastern,
} from './guestUi';
import { buttonClass, cardClass, inputClass } from './incidentUi';

interface DayResponse {
  available: boolean;
  date: string;
  sessions: RosterSession[];
  error?: string;
}

interface RosterResponse {
  available: boolean;
  date: string;
  roster: SessionRoster | null;
  people: PeopleNames;
  error?: string;
}

function profileHref(memberId: string, name: string, email: string): string {
  const params = new URLSearchParams();
  if (name) params.set('name', name);
  if (email) params.set('email', email);
  const qs = params.toString();
  return `/admin/guests/${memberId}${qs ? `?${qs}` : ''}`;
}

export function GuestSessions() {
  const today = useMemo(() => todayEastern(), []);
  const [date, setDate] = useState(today);
  const [openId, setOpenId] = useState<string | null>(null);

  const day = useCachedJson<DayResponse>(`/api/admin/guest-sessions?date=${date}`, {
    maxAgeMs: 2 * 60_000,
  });
  const roster = useCachedJson<RosterResponse>(
    openId ? `/api/admin/guest-sessions?date=${date}&sessionId=${openId}` : null,
    { maxAgeMs: 60_000 }
  );

  const sessions = day.data?.sessions ?? [];
  const nowMs = Date.now();

  const move = (next: string) => {
    setDate(next);
    setOpenId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass} onClick={() => move(shiftDate(date, -1))}>
          ← Prev
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={date === today}
          onClick={() => move(today)}
        >
          Today
        </button>
        <button type="button" className={buttonClass} onClick={() => move(shiftDate(date, 1))}>
          Next →
        </button>
        <label className="sr-only" htmlFor="roster-date">
          Date
        </label>
        <input
          id="roster-date"
          type="date"
          className={`${inputClass} w-auto py-2`}
          value={date}
          onChange={(e) => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) move(e.target.value);
          }}
        />
        <span className="font-mono text-xs text-white/45">{formatDateLabel(date)}</span>
        {day.refreshing && <span className="font-mono text-xs text-white/35">Refreshing…</span>}
      </div>

      {day.loading && <p className="font-mono text-xs text-white/40">Asking Momence…</p>}
      {day.error && (
        <p className="text-sm text-[var(--pyre-red)]">Couldn't load sessions: {day.error}</p>
      )}
      {day.data && !day.data.available && (
        <p className="text-sm text-[var(--pyre-gold)]">{day.data.error}</p>
      )}
      {day.data?.available && sessions.length === 0 && (
        <div className={cardClass}>
          <p className="text-sm text-white/60">No sessions on the schedule for this day.</p>
        </div>
      )}

      <ul className="space-y-3">
        {sessions.map((session) => {
          const open = openId === session.id;
          const past = Date.parse(session.endsAt) < nowMs;
          return (
            <li key={session.id} className={`${cardClass} ${past ? 'opacity-70' : ''}`}>
              <button
                type="button"
                className="flex w-full items-start justify-between gap-3 text-left"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : session.id)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-primary-semibold text-[var(--pyre-creme)]">
                    {session.name}
                  </span>
                  <span className="mt-0.5 block font-mono text-xs text-white/45">
                    {formatTimeRange(session.startsAt, session.endsAt)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-sm text-[var(--pyre-creme)]">
                    {session.bookingCount}
                    {session.capacity ? ` / ${session.capacity}` : ''}
                  </span>
                  <span className="block font-mono text-[10px] uppercase tracking-wide text-white/35">
                    {open ? 'Hide' : 'Who’s booked'}
                  </span>
                </span>
              </button>

              {open && (
                <div className="mt-4 border-t border-white/5 pt-4">
                  {roster.loading && (
                    <p className="font-mono text-xs text-white/40">
                      Looking up everyone booked… this takes a few seconds.
                    </p>
                  )}
                  {roster.error && (
                    <p className="text-sm text-[var(--pyre-red)]">Couldn't load: {roster.error}</p>
                  )}
                  {roster.data && !roster.data.available && (
                    <p className="text-sm text-[var(--pyre-gold)]">{roster.data.error}</p>
                  )}
                  {roster.data?.roster && (
                    <RosterList roster={roster.data.roster} people={roster.data.people} />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RosterList({ roster, people }: { roster: SessionRoster; people: PeopleNames }) {
  if (roster.guests.length === 0) {
    return (
      <p className="text-sm text-white/60">
        {roster.session.bookingCount > 0 && !roster.identityAvailable
          ? `Momence reports ${roster.session.bookingCount} booked but returned no names.`
          : 'Nobody booked yet.'}
      </p>
    );
  }

  const newcomers = roster.guests.filter((g) => g.firstVisit).length;

  return (
    <div className="space-y-3">
      <p className="font-mono text-[10px] uppercase tracking-wide text-white/35">
        {roster.guests.length} {roster.guests.length === 1 ? 'person' : 'people'}
        {newcomers > 0 ? ` · ${newcomers} first visit${newcomers === 1 ? '' : 's'}` : ''}
        {!roster.enriched ? ' · Momence details partly unavailable' : ''}
        {!roster.identityAvailable ? ' · some bookings carried no name' : ''}
      </p>

      <ul className="divide-y divide-white/5">
        {roster.guests.map((guest) => (
          <li key={guest.memberId || guest.email} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              {guest.memberId ? (
                <a
                  href={profileHref(guest.memberId, guest.name, guest.email)}
                  className="text-sm font-primary-semibold text-[var(--pyre-creme)] hover:underline"
                >
                  {guest.name || guest.email}
                </a>
              ) : (
                <span className="text-sm font-primary-semibold text-[var(--pyre-creme)]">
                  {guest.name || guest.email}
                </span>
              )}
              {guest.seats > 1 && <QuietBadge>×{guest.seats}</QuietBadge>}
              {guest.firstVisit && <FirstVisitBadge />}
              {guest.checkedIn && <CheckedInBadge />}
              {guest.standing && <StandingBadge standing={guest.standing} />}
              {guest.visitsAttended !== null && !guest.firstVisit && (
                <QuietBadge>
                  {guest.visitsAttended} visit{guest.visitsAttended === 1 ? '' : 's'}
                </QuietBadge>
              )}
              {guest.tags.map((tag) => (
                <QuietBadge key={tag}>{tag}</QuietBadge>
              ))}
            </div>

            {guest.summary && (
              <p className="mt-1 text-sm leading-snug text-white/75">{guest.summary}</p>
            )}

            {guest.highlights.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {guest.highlights.map((h) => (
                  <AnswerPill key={h.key} label={h.label} value={h.value} />
                ))}
              </div>
            )}

            {guest.latestNote && (
              <p className="mt-1.5 text-xs leading-snug text-white/50">
                “{guest.latestNote.body}”
                <span className="ml-1 font-mono text-[10px] uppercase tracking-wide text-white/30">
                  — {personName(guest.latestNote.author, people)}, {timeAgo(guest.latestNote.at)}
                </span>
              </p>
            )}

            {!guest.profileId && guest.memberId && (
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-white/30">
                No profile yet —{' '}
                <a
                  href={profileHref(guest.memberId, guest.name, guest.email)}
                  className="underline hover:text-white"
                >
                  start one for {firstNameOf(guest.name) || 'them'}
                </a>
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default GuestSessions;
