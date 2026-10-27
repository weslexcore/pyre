// On the floor (/admin/guests/floor).
//
// Everyone checked in right now, with when they came in, how long their
// session runs, and a bar of how much of it is behind them — sorted so the
// guests due their 15-minute warning are at the top. Below, whoever is booked
// into a current or upcoming session and not here yet, with a Check in button
// that checks them in on Momence and starts their clock.
//
// The list refetches every half minute; the bars re-run the timing locally
// every few seconds in between.

import { easternToUtc, todayEastern, utcToEastern } from '@pyre/schedule-core';
import { useEffect, useMemo, useState } from 'react';
import { buttonClass, cardClass, compactSelectClass, goldButtonClass } from '@/components/admin/ui';
import { sendJson } from '@/lib/client/api';
import { useCachedJson } from '@/lib/client/cachedJson';
import { etTime } from '@/lib/client/format';
import { timeAgo } from '@/lib/client/relativeTime';
import {
  compareFloor,
  type FloorGuest,
  type FloorSession,
  type FloorStatus,
  type FloorTiming,
  floorTiming,
  MINUTE_MS,
  onFloor,
  SESSION_LENGTH_CHOICES,
  WARNING_MINUTES,
} from '@/lib/guests/floor-timing';
import { QuietBadge } from './guestUi';

interface FloorResponse {
  available: boolean;
  now: string;
  sessions: FloorSession[];
  guests: FloorGuest[];
  complete: boolean;
  error?: string;
}

const FLOOR_URL = '/api/admin/guest-floor';
const REFETCH_MS = 30_000;
const TICK_MS = 5_000;

const BAR_COLORS: Record<FloorStatus, string> = {
  waiting: 'bg-white/20',
  in: 'bg-[var(--pyre-sage)]',
  warn: 'bg-[var(--pyre-gold)]',
  over: 'bg-[var(--pyre-red)]',
};

function remainingLabel(timing: FloorTiming): string {
  const minutes = Math.ceil(Math.abs(timing.remainingMs) / MINUTE_MS);
  return timing.status === 'over' ? `Over by ${minutes} min` : `${minutes} min left`;
}

/** "18:05" on the studio clock, for a time input. */
function wallClock(iso: string): string {
  const { minutes } = utcToEastern(iso);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function GuestFloor() {
  const floor = useCachedJson<FloorResponse>(FLOOR_URL, { maxAgeMs: 60_000 });
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'error' | 'warn' } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const { reload } = floor;
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, REFETCH_MS);
    return () => clearInterval(id);
  }, [reload]);

  const sessions = useMemo(
    () => new Map((floor.data?.sessions ?? []).map((s) => [s.id, s])),
    [floor.data]
  );

  const guests = floor.data?.guests ?? [];
  const inside = guests
    .filter((g) => g.checkedIn)
    .map((guest) => ({ guest, timing: floorTiming(guest, now) }))
    .filter(({ timing }) => onFloor(timing))
    .sort((a, b) => compareFloor(a.timing, b.timing));
  const waiting = guests
    .filter((g) => !g.checkedIn && Date.parse(sessions.get(g.sessionId)?.endsAt ?? '') > now)
    .sort(
      (a, b) =>
        (sessions.get(a.sessionId)?.startsAt ?? '').localeCompare(
          sessions.get(b.sessionId)?.startsAt ?? ''
        ) || a.name.localeCompare(b.name)
    );
  const dueNow = inside.filter(({ guest, timing }) => timing.status === 'warn' && !guest.warnedAt);

  async function act(guest: FloorGuest, run: () => Promise<{ momenceSynced?: boolean }>) {
    setBusy(guest.bookingId);
    setNotice(null);
    try {
      const result = await run();
      if (result.momenceSynced === false) {
        setNotice({
          tone: 'warn',
          text: `${guest.name}'s clock started, but Momence didn't take the check-in. Check them in there too.`,
        });
      }
      await reload();
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  const ids = (guest: FloorGuest) => ({ sessionId: guest.sessionId, bookingId: guest.bookingId });

  const checkIn = (guest: FloorGuest) =>
    act(guest, () => sendJson<{ momenceSynced: boolean }>(FLOOR_URL, 'POST', ids(guest)));

  // A guest checked in elsewhere has only an estimated time; send it along
  // so the first edit records the time they were already being shown.
  const patch = (guest: FloorGuest, changes: Record<string, unknown>) =>
    act(guest, () =>
      sendJson(FLOOR_URL, 'PATCH', {
        ...ids(guest),
        ...(guest.estimated && { checkedInAt: guest.checkedInAt }),
        ...changes,
      })
    );

  const undo = (guest: FloorGuest) => {
    if (!window.confirm(`Undo ${guest.name}'s check-in? This also un-checks them in Momence.`)) {
      return;
    }
    setEditing(null);
    void act(guest, () => sendJson(`${FLOOR_URL}?${new URLSearchParams(ids(guest))}`, 'DELETE'));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-[var(--pyre-creme)]">
          {dueNow.length > 0
            ? `${dueNow.length} ${dueNow.length === 1 ? 'guest needs' : 'guests need'} a ${WARNING_MINUTES}-minute warning`
            : `Nobody needs a warning right now`}
        </p>
        <button
          type="button"
          className={buttonClass}
          disabled={floor.refreshing}
          onClick={() => void reload()}
        >
          {floor.refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        {floor.data && (
          <span className="font-mono text-xs text-white/35">Updated {timeAgo(floor.data.now)}</span>
        )}
      </div>

      {notice && (
        <p
          className={`text-sm ${notice.tone === 'error' ? 'text-[var(--pyre-red)]' : 'text-[var(--pyre-gold)]'}`}
        >
          {notice.text}
        </p>
      )}
      {floor.loading && <p className="font-mono text-xs text-white/40">Asking Momence…</p>}
      {floor.error && (
        <p className="text-sm text-[var(--pyre-red)]">Couldn't load the floor: {floor.error}</p>
      )}
      {floor.data && !floor.data.available && (
        <p className="text-sm text-[var(--pyre-gold)]">{floor.data.error}</p>
      )}
      {floor.data?.available && !floor.data.complete && (
        <p className="text-sm text-[var(--pyre-gold)]">
          Momence didn't return every session's bookings — some guests may be missing.
        </p>
      )}

      <section className="space-y-3">
        <h2 className="font-mono text-xs uppercase tracking-wide text-white/50">
          Checked in · {inside.length}
        </h2>
        {floor.data?.available && inside.length === 0 && (
          <div className={cardClass}>
            <p className="text-sm text-white/60">Nobody is checked in right now.</p>
          </div>
        )}
        <ul className="space-y-2">
          {inside.map(({ guest, timing }) => (
            <li
              key={guest.bookingId}
              className={`${cardClass} ${timing.status === 'warn' && !guest.warnedAt ? 'border-[var(--pyre-gold)]/60' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-primary-semibold text-[var(--pyre-creme)]">
                      {guest.name}
                    </span>
                    {guest.seats > 1 && <QuietBadge>×{guest.seats}</QuietBadge>}
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-white/45">
                    In {guest.checkedInAt ? etTime(guest.checkedInAt) : '—'}
                    {guest.estimated ? ' (est.)' : ''} · {guest.minutes} min
                    {timing.endsAt
                      ? ` · ends ${etTime(new Date(timing.endsAt).toISOString())}`
                      : ''}
                    {' · '}
                    {sessions.get(guest.sessionId)?.name ?? 'Session'}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <span
                    className={`block font-mono text-sm ${
                      timing.status === 'over'
                        ? 'text-[var(--pyre-red)]'
                        : timing.status === 'warn'
                          ? 'text-[var(--pyre-gold)]'
                          : 'text-[var(--pyre-creme)]'
                    }`}
                  >
                    {remainingLabel(timing)}
                  </span>
                  {guest.warnedAt && (
                    <span className="block font-mono text-[10px] uppercase tracking-wide text-white/35">
                      Warned {etTime(guest.warnedAt)}
                    </span>
                  )}
                </div>
              </div>

              <div
                className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"
                role="progressbar"
                aria-label={`${guest.name}'s session`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(timing.progress * 100)}
              >
                <div
                  className={`h-full rounded-full transition-[width] duration-1000 ${BAR_COLORS[timing.status]}`}
                  style={{ width: `${timing.progress * 100}%` }}
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {(timing.status === 'warn' || timing.status === 'over') && (
                  <button
                    type="button"
                    className={guest.warnedAt ? buttonClass : goldButtonClass}
                    disabled={busy === guest.bookingId}
                    onClick={() => void patch(guest, { warned: !guest.warnedAt })}
                  >
                    {guest.warnedAt ? 'Not warned' : 'Mark warned'}
                  </button>
                )}
                <button
                  type="button"
                  className={buttonClass}
                  aria-expanded={editing === guest.bookingId}
                  onClick={() => setEditing(editing === guest.bookingId ? null : guest.bookingId)}
                >
                  {editing === guest.bookingId ? 'Done' : 'Adjust'}
                </button>
              </div>

              {editing === guest.bookingId && (
                <AdjustGuest
                  guest={guest}
                  session={sessions.get(guest.sessionId)}
                  busy={busy === guest.bookingId}
                  onPatch={(changes) => void patch(guest, changes)}
                  onUndo={() => undo(guest)}
                />
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-mono text-xs uppercase tracking-wide text-white/50">
          Booked, not checked in · {waiting.length}
        </h2>
        {floor.data?.available && waiting.length === 0 && (
          <p className="text-sm text-white/50">
            No one else is booked into a current or upcoming session.
          </p>
        )}
        <ul className="divide-y divide-white/5 rounded border border-white/10 bg-white/[0.03]">
          {waiting.map((guest) => {
            const session = sessions.get(guest.sessionId);
            return (
              <li key={guest.bookingId} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-primary-semibold text-[var(--pyre-creme)]">
                      {guest.name}
                    </span>
                    {guest.seats > 1 && <QuietBadge>×{guest.seats}</QuietBadge>}
                  </span>
                  <span className="mt-0.5 block font-mono text-xs text-white/45">
                    {session ? `${session.name} · ${etTime(session.startsAt)}` : 'Session'} ·{' '}
                    {guest.minutes} min
                  </span>
                </div>
                <button
                  type="button"
                  className={goldButtonClass}
                  disabled={busy === guest.bookingId}
                  onClick={() => void checkIn(guest)}
                >
                  {busy === guest.bookingId ? 'Checking in…' : 'Check in'}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function AdjustGuest({
  guest,
  session,
  busy,
  onPatch,
  onUndo,
}: {
  guest: FloorGuest;
  session: FloorSession | undefined;
  busy: boolean;
  onPatch: (changes: Record<string, unknown>) => void;
  onUndo: () => void;
}) {
  const [time, setTime] = useState(() => (guest.checkedInAt ? wallClock(guest.checkedInAt) : ''));
  const defaultMinutes = session?.minutes ?? guest.minutes;
  const lengths = [...new Set([defaultMinutes, guest.minutes, ...SESSION_LENGTH_CHOICES])].sort(
    (a, b) => a - b
  );
  const timeChanged = !!guest.checkedInAt && time !== wallClock(guest.checkedInAt);

  return (
    <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-white/5 pt-3">
      <label className="block">
        <span className="block font-mono text-[10px] uppercase tracking-wide text-white/50">
          Checked in at
        </span>
        <span className="mt-1 flex gap-2">
          <input
            type="time"
            className={`${compactSelectClass} w-32`}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
          <button
            type="button"
            className={buttonClass}
            disabled={busy || !time || (!timeChanged && !guest.estimated)}
            onClick={() => onPatch({ checkedInAt: easternToUtc(todayEastern(), time) })}
          >
            {guest.estimated && !timeChanged ? 'Confirm' : 'Save'}
          </button>
        </span>
      </label>
      <label className="block">
        <span className="block font-mono text-[10px] uppercase tracking-wide text-white/50">
          Session length
        </span>
        <select
          className={`${compactSelectClass} mt-1`}
          value={guest.minutes}
          disabled={busy}
          onChange={(e) => {
            const minutes = Number(e.target.value);
            onPatch({ minutes: minutes === defaultMinutes ? null : minutes });
          }}
        >
          {lengths.map((m) => (
            <option key={m} value={m}>
              {m} min{m === defaultMinutes ? ' (scheduled)' : ''}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className={`${buttonClass} ml-auto`} disabled={busy} onClick={onUndo}>
        Undo check-in
      </button>
    </div>
  );
}

export default GuestFloor;
