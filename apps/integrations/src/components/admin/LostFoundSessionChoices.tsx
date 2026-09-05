// The list of sessions an item could have been left in, and the choosing of
// them. Shared by the log form (pick while you're standing there with the
// bottle) and the item page (pick again, or send what was already picked).
//
// Addresses are masked in the response this renders: choosing which sessions
// to ask does not require reading forty guests' email addresses, and the
// notify route resolves the real ones server-side from the session ids.
//
// Two states are deliberately not merged. A session nobody booked is dropped
// from the list — it is noise between the ones that matter — but a session
// that had bookings and came back without contact details stays, greyed, with
// the count. "Nobody was here" and "we can't see who was here" are different
// problems and only the second is worth escalating.

import { useMemo } from 'react';
import { useCachedJson } from '@/lib/client/cachedJson';
import { cardClass } from './incidentUi';

export interface SessionAttendee {
  name: string;
  maskedEmail: string;
  checkedIn: boolean;
}

export interface PickerSession {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  bookingCount: number;
  identityAvailable: boolean;
  attendees: SessionAttendee[];
}

export interface SessionsResponse {
  available: boolean;
  identityAvailable: boolean;
  sessions: PickerSession[];
  error?: string;
}

export function sessionTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  return new Date(ms).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Sessions worth offering: somebody was booked, whether or not we can name them. */
export function askableSessions(sessions: PickerSession[]): PickerSession[] {
  return sessions.filter((s) => s.attendees.length > 0 || s.bookingCount > 0);
}

/** How many people a selection actually reaches, minus anyone already asked. */
export function countReachable(
  sessions: PickerSession[],
  picked: Set<string>,
  alreadyAsked: Set<string>
): number {
  let count = 0;
  for (const session of sessions) {
    if (!picked.has(session.id)) continue;
    for (const attendee of session.attendees) {
      if (!alreadyAsked.has(attendee.maskedEmail)) count += 1;
    }
  }
  return count;
}

/** Loads the sessions overlapping a window, with the people in each. */
export function useSessionChoices(startIso: string, endIso: string) {
  const url =
    startIso && endIso
      ? `/api/admin/lost-found-sessions?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`
      : null;
  const { data, loading } = useCachedJson<SessionsResponse>(url);
  const sessions = useMemo(() => askableSessions(data?.sessions ?? []), [data?.sessions]);
  return {
    data,
    loading,
    /** Sessions to offer, empty ones removed. */
    sessions,
    /** How many were dropped for having nobody booked, so the gap is explained. */
    hiddenCount: (data?.sessions ?? []).length - sessions.length,
  };
}

export function SessionChoices({
  data,
  loading,
  sessions,
  hiddenCount,
  picked,
  alreadyAsked,
  onToggle,
  emptyHint,
}: {
  data: SessionsResponse | null | undefined;
  loading: boolean;
  sessions: PickerSession[];
  hiddenCount: number;
  picked: Set<string>;
  /** Masked addresses already emailed about this item. Empty on the log form. */
  alreadyAsked: Set<string>;
  onToggle: (id: string) => void;
  /** What to suggest when there is nothing to pick. */
  emptyHint: string;
}) {
  if (loading) return <p className="font-mono text-xs text-white/40">Checking who was here…</p>;

  if (data?.available === false) {
    return (
      <div className={cardClass}>
        <p className="text-sm text-white/60">
          {data.error ?? "Momence is unreachable — can't look up who was in session."}
        </p>
      </div>
    );
  }

  if (sessions.length === 0) {
    const ran = (data?.sessions ?? []).length;
    return (
      <div className={cardClass}>
        <p className="text-sm text-white/60">
          {ran === 0
            ? 'No sessions were running then.'
            : `Sessions ran then, but nobody was booked into ${ran === 1 ? 'it' : 'them'}.`}{' '}
          {emptyHint}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data?.identityAvailable === false && (
        <div className={`${cardClass} border-[var(--pyre-red)]/40`}>
          <p className="text-sm text-[var(--pyre-creme)]">
            Momence returned bookings for these sessions but no contact details, so there is nobody
            to email. Worth flagging — the booking data changed shape.
          </p>
        </div>
      )}

      <ul className="space-y-2">
        {sessions.map((session) => {
          const selected = picked.has(session.id);
          const fresh = session.attendees.filter((a) => !alreadyAsked.has(a.maskedEmail));
          const disabled = fresh.length === 0;
          return (
            <li key={session.id}>
              <button
                type="button"
                onClick={() => onToggle(session.id)}
                disabled={disabled}
                aria-pressed={selected}
                className={`w-full rounded border px-3 py-3 text-left transition-colors ${
                  selected
                    ? 'border-[var(--pyre-gold)] bg-[var(--pyre-gold)]/10'
                    : 'border-white/10 bg-white/5 hover:border-white/30'
                } ${disabled ? 'opacity-45' : ''}`}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-[var(--pyre-creme)]">
                      {session.name}
                    </span>
                    <span className="block font-mono text-xs text-white/45">
                      {sessionTime(session.startsAt)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right font-mono text-xs text-white/50">
                    {session.attendees.length}{' '}
                    {session.attendees.length === 1 ? 'person' : 'people'}
                    {session.attendees.length !== fresh.length && (
                      <span className="block text-[10px] uppercase text-white/30">
                        {session.attendees.length - fresh.length} already asked
                      </span>
                    )}
                  </span>
                </span>

                {session.bookingCount > 0 && !session.identityAvailable && (
                  <span className="mt-1.5 block font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-red)]">
                    {session.bookingCount} booked, no contact details
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {hiddenCount > 0 && (
        <p className="font-mono text-xs text-white/30">
          {hiddenCount} {hiddenCount === 1 ? 'session' : 'sessions'} with nobody booked{' '}
          {hiddenCount === 1 ? 'is' : 'are'} not listed.
        </p>
      )}
    </div>
  );
}
