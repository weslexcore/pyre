// Choosing who to ask when we don't know whose it is.
//
// This is the one screen in the tool that can email dozens of strangers, so it
// is built to make that deliberate rather than easy: nothing is pre-selected,
// the count of people about to be emailed is stated in words next to the
// button, and the button says how many. Momence attendee addresses are masked
// here — picking a session doesn't require reading forty guests' emails, and
// the server resolves the real ones from the session ids.
//
// The "no contact details" case is called out explicitly instead of rendering
// an empty list, because "nobody was here" and "we can't see who was here" are
// different problems and only one of them is worth escalating.

import { useMemo, useState } from 'react';
import { useCachedJson } from '@/lib/client/cachedJson';
import { buttonClass, cardClass, primaryButtonClass, readError } from './incidentUi';

interface SessionAttendee {
  name: string;
  maskedEmail: string;
  checkedIn: boolean;
}

interface PickerSession {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  bookingCount: number;
  identityAvailable: boolean;
  attendees: SessionAttendee[];
}

interface SessionsResponse {
  available: boolean;
  identityAvailable: boolean;
  sessions: PickerSession[];
  error?: string;
}

function sessionTime(iso: string): string {
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

export function LostFoundSessionPicker({
  itemId,
  windowStart,
  windowEnd,
  alreadyAsked,
  onSent,
}: {
  itemId: string;
  windowStart: string;
  windowEnd: string;
  /** Masked addresses we've already emailed about this item. */
  alreadyAsked: Set<string>;
  onSent: (summary: string) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = `/api/admin/lost-found-sessions?start=${encodeURIComponent(windowStart)}&end=${encodeURIComponent(windowEnd)}`;
  const { data, loading } = useCachedJson<SessionsResponse>(url);

  const sessions = data?.sessions ?? [];

  const reachable = useMemo(() => {
    let count = 0;
    for (const session of sessions) {
      if (!picked.has(session.id)) continue;
      for (const attendee of session.attendees) {
        if (!alreadyAsked.has(attendee.maskedEmail)) count += 1;
      }
    }
    return count;
  }, [sessions, picked, alreadyAsked]);

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/lost-found-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, mode: 'sessions', sessionIds: [...picked] }),
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const result = (await res.json()) as {
        sent: number;
        alreadyAsked: number;
        failed: number;
      };
      setPicked(new Set());
      onSent(
        `Asked ${result.sent} ${result.sent === 1 ? 'person' : 'people'}` +
          (result.alreadyAsked > 0 ? `, ${result.alreadyAsked} already asked` : '') +
          (result.failed > 0 ? `, ${result.failed} failed` : '')
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setSending(false);
    }
  };

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
    return (
      <div className={cardClass}>
        <p className="text-sm text-white/60">
          No sessions were running in that window. Widen the window on the item if this could have
          been sitting there longer.
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
                onClick={() => toggle(session.id)}
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

      {error && <p className="text-sm text-[var(--pyre-red)]">{error}</p>}

      <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-3">
        <button
          type="button"
          className={primaryButtonClass}
          disabled={sending || reachable === 0}
          onClick={() => void send()}
        >
          {sending
            ? 'Sending…'
            : reachable === 0
              ? 'Pick a session'
              : `Ask ${reachable} ${reachable === 1 ? 'person' : 'people'}`}
        </button>
        {picked.size > 0 && (
          <button type="button" className={buttonClass} onClick={() => setPicked(new Set())}>
            Clear
          </button>
        )}
        <span className="text-xs text-white/40">
          Each person is asked once about this item, however many sessions they were in.
        </span>
      </div>
    </div>
  );
}
