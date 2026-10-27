// Check Ins (/admin/guests/check-ins).
//
// Everyone checked in right now, with when they came in, how long their
// session runs, a bar of how much of it is behind them, and the check-ins
// staff make with them (set on /admin/settings: a 15-minute warning, a water
// top-up, ...) — sorted so guests with a check-in due are at the top. Tapping
// a due check-in marks it done. Below, whoever is booked
// into a current or upcoming session and not here yet, with a Check in button
// that checks them in on Momence and starts their clock. A guest rebooked
// into a longer or shorter session keeps the arrival time from the booking
// they moved from (lib/guests/floor.ts findMoves). Check out takes a guest
// off the list (Momence has no check-out; it's ours alone) and into Checked
// out at the bottom, with an undo.
//
// The list refetches every half minute; the bars re-run the timing locally
// every few seconds in between.

import { easternToUtc, todayEastern, utcToEastern } from '@pyre/schedule-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buttonClass, cardClass, compactSelectClass, goldButtonClass } from '@/components/admin/ui';
import { sendJson } from '@/lib/client/api';
import { useCachedJson } from '@/lib/client/cachedJson';
import { etTime } from '@/lib/client/format';
import { timeAgo } from '@/lib/client/relativeTime';
import { useDebounced } from '@/lib/client/useDebounced';
import {
  type Checkpoint,
  type CheckpointTiming,
  compareFloor,
  type FloorGuest,
  type FloorMove,
  type FloorSession,
  type FloorStatus,
  type FloorTiming,
  floorTiming,
  MINUTE_MS,
  onFloor,
} from '@/lib/guests/floor-timing';
import { QuietBadge } from './guestUi';

interface FloorResponse {
  available: boolean;
  now: string;
  checkpoints: Checkpoint[];
  sessionLengths: number[];
  sessions: FloorSession[];
  guests: FloorGuest[];
  complete: boolean;
  error?: string;
}

const FLOOR_URL = '/api/admin/guest-checkins';
const REFETCH_MS = 30_000;
const TICK_MS = 5_000;
/** A typed check-in time saves once it has sat this long (or on blur). */
const TIME_AUTOSAVE_MS = 800;

const BAR_COLORS: Record<FloorStatus, string> = {
  waiting: 'bg-white/20',
  in: 'bg-[var(--pyre-sage)]',
  due: 'bg-[var(--pyre-gold)]',
  over: 'bg-[var(--pyre-red)]',
};

function remainingLabel(timing: FloorTiming): string {
  const minutes = Math.ceil(Math.abs(timing.remainingMs) / MINUTE_MS);
  return timing.status === 'over' ? `Over by ${minutes} min` : `${minutes} min left`;
}

/** "Moved from Open Hours (120 min)". */
function movedLabel(from: FloorMove): string {
  if (!from.sessionName) return 'Moved from another session';
  return `Moved from ${from.sessionName}${from.sessionMinutes ? ` (${from.sessionMinutes} min)` : ''}`;
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

export function GuestCheckIns() {
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
  const checkpoints = floor.data?.checkpoints ?? [];
  const sessionLengths = floor.data?.sessionLengths ?? [];
  const inside = guests
    .filter((g) => g.checkedIn && !g.checkedOutAt)
    .map((guest) => ({ guest, timing: floorTiming(guest, checkpoints, now) }))
    .filter(({ timing }) => onFloor(timing, now))
    .sort((a, b) => compareFloor(a.timing, b.timing));
  const waiting = guests
    .filter((g) => !g.checkedIn && Date.parse(sessions.get(g.sessionId)?.endsAt ?? '') > now)
    .sort(
      (a, b) =>
        (sessions.get(a.sessionId)?.startsAt ?? '').localeCompare(
          sessions.get(b.sessionId)?.startsAt ?? ''
        ) || a.name.localeCompare(b.name)
    );
  const checkedOut = guests
    .filter((g) => g.checkedOutAt)
    .sort((a, b) => (b.checkedOutAt ?? '').localeCompare(a.checkedOutAt ?? ''));
  const dueNow = inside.filter(({ timing }) => timing.status === 'due');

  /** Run one change for a guest; resolves true when it saved. */
  async function act(
    guest: FloorGuest,
    run: () => Promise<{ momenceSynced?: boolean }>
  ): Promise<boolean> {
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
      return true;
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
      return false;
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
        {checkpoints.length > 0 && (
          <p className="text-sm text-[var(--pyre-creme)]">
            {dueNow.length > 0
              ? `${dueNow.length} ${dueNow.length === 1 ? 'guest has' : 'guests have'} a check-in due`
              : 'No check-ins due right now'}
          </p>
        )}
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
              className={`${cardClass} ${timing.status === 'due' ? 'border-[var(--pyre-gold)]/60' : ''}`}
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
                  {guest.movedFrom && (
                    <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-white/35">
                      {movedLabel(guest.movedFrom)}, arrival time kept
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <span
                    className={`block font-mono text-sm ${
                      timing.status === 'over'
                        ? 'text-[var(--pyre-red)]'
                        : timing.status === 'due'
                          ? 'text-[var(--pyre-gold)]'
                          : 'text-[var(--pyre-creme)]'
                    }`}
                  >
                    {remainingLabel(timing)}
                  </span>
                </div>
              </div>

              <div
                className="relative mt-3 h-2 overflow-hidden rounded-full bg-white/10"
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
                {timing.endsAt !== null &&
                  timing.checkpoints.map((c) => {
                    const start = (timing.endsAt ?? 0) - guest.minutes * MINUTE_MS;
                    const at = (c.dueAt - start) / (guest.minutes * MINUTE_MS);
                    if (at <= 0 || at >= 1) return null;
                    return (
                      <span
                        key={c.checkpoint.id}
                        aria-hidden="true"
                        className="absolute inset-y-0 w-0.5 bg-[var(--pyre-black)]/70"
                        style={{ left: `${at * 100}%` }}
                      />
                    );
                  })}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {timing.checkpoints.map((c) => (
                  <CheckpointChip
                    key={c.checkpoint.id}
                    timing={c}
                    busy={busy === guest.bookingId}
                    onToggle={() =>
                      void patch(guest, { checkpoint: { id: c.checkpoint.id, done: !c.done } })
                    }
                  />
                ))}
                <button
                  type="button"
                  className={buttonClass}
                  aria-expanded={editing === guest.bookingId}
                  onClick={() => setEditing(editing === guest.bookingId ? null : guest.bookingId)}
                >
                  {editing === guest.bookingId ? 'Done' : 'Adjust'}
                </button>
                <button
                  type="button"
                  className={`${buttonClass} ml-auto`}
                  disabled={busy === guest.bookingId}
                  onClick={() => {
                    setEditing(null);
                    void patch(guest, { checkedOut: true });
                  }}
                >
                  {busy === guest.bookingId ? 'Checking out…' : 'Check out'}
                </button>
              </div>

              {editing === guest.bookingId && (
                <AdjustGuest
                  guest={guest}
                  session={sessions.get(guest.sessionId)}
                  sessionLengths={sessionLengths}
                  busy={busy === guest.bookingId}
                  onPatch={(changes) => patch(guest, changes)}
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
                  {guest.movedFrom && (
                    <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)]">
                      {movedLabel(guest.movedFrom)} · check in to keep their{' '}
                      {etTime(guest.movedFrom.arrivedAt)} arrival
                    </span>
                  )}
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

      {checkedOut.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-mono text-xs uppercase tracking-wide text-white/50">
            Checked out · {checkedOut.length}
          </h2>
          <ul className="divide-y divide-white/5 rounded border border-white/10 bg-white/[0.03]">
            {checkedOut.map((guest) => {
              const stayed =
                guest.checkedInAt && guest.checkedOutAt
                  ? Math.round(
                      (Date.parse(guest.checkedOutAt) - Date.parse(guest.checkedInAt)) / MINUTE_MS
                    )
                  : null;
              return (
                <li key={guest.bookingId} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-white/70">{guest.name}</span>
                      {guest.seats > 1 && <QuietBadge>×{guest.seats}</QuietBadge>}
                    </span>
                    <span className="mt-0.5 block font-mono text-xs text-white/40">
                      {guest.checkedInAt ? etTime(guest.checkedInAt) : '—'} –{' '}
                      {guest.checkedOutAt ? etTime(guest.checkedOutAt) : '—'}
                      {stayed !== null ? ` · ${stayed} of ${guest.minutes} min` : ''}
                      {' · '}
                      {sessions.get(guest.sessionId)?.name ?? 'Session'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={busy === guest.bookingId}
                    onClick={() => void patch(guest, { checkedOut: false })}
                  >
                    Undo check-out
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * One check-in on a guest's card: due ones are the gold button that marks
 * them done; done ones say when, and tap again to un-mark; upcoming ones say
 * when they're due.
 */
function CheckpointChip({
  timing,
  busy,
  onToggle,
}: {
  timing: CheckpointTiming;
  busy: boolean;
  onToggle: () => void;
}) {
  const { checkpoint, done, due, dueAt } = timing;
  if (due) {
    return (
      <button type="button" className={goldButtonClass} disabled={busy} onClick={onToggle}>
        {checkpoint.label} · Mark done
      </button>
    );
  }
  if (done) {
    return (
      <button
        type="button"
        className="rounded border border-[var(--pyre-sage)]/40 bg-[var(--pyre-sage)]/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-[var(--pyre-sage)] transition-colors hover:border-[var(--pyre-sage)] disabled:opacity-40"
        disabled={busy}
        title="Tap to mark not done"
        onClick={onToggle}
      >
        {checkpoint.label} · Done {etTime(done.at)}
      </button>
    );
  }
  return (
    <span className="rounded border border-white/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-white/40">
      {checkpoint.label} · {etTime(new Date(dueAt).toISOString())}
    </span>
  );
}

function AdjustGuest({
  guest,
  session,
  sessionLengths,
  busy,
  onPatch,
  onUndo,
}: {
  guest: FloorGuest;
  session: FloorSession | undefined;
  sessionLengths: number[];
  busy: boolean;
  onPatch: (changes: Record<string, unknown>) => Promise<boolean>;
  onUndo: () => void;
}) {
  const saved = guest.checkedInAt ? wallClock(guest.checkedInAt) : '';
  const [time, setTime] = useState(saved);
  const [timeState, setTimeState] = useState<'idle' | 'saving' | 'saved' | 'future'>('idle');
  // The last value sent, so the debounce and a blur don't save it twice.
  const sent = useRef(saved);
  const debounced = useDebounced(time, TIME_AUTOSAVE_MS);

  // A save (or someone else's) moves the recorded time: show it.
  useEffect(() => {
    setTime(saved);
    sent.current = saved;
  }, [saved]);

  const saveTime = (value: string) => {
    if (!/^\d{2}:\d{2}$/.test(value) || value === sent.current) return;
    const at = easternToUtc(todayEastern(), value);
    if (Date.parse(at) > Date.now()) {
      setTimeState('future');
      return;
    }
    sent.current = value;
    setTimeState('saving');
    void onPatch({ checkedInAt: at }).then((ok) => {
      if (ok) setTimeState('saved');
      else {
        sent.current = saved;
        setTimeState('idle');
      }
    });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: saves only when the settled value changes
  useEffect(() => saveTime(debounced), [debounced]);

  const defaultMinutes = session?.minutes ?? guest.minutes;
  const lengths = [...new Set([defaultMinutes, guest.minutes, ...sessionLengths])].sort(
    (a, b) => a - b
  );

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
            onChange={(e) => {
              setTime(e.target.value);
              setTimeState('idle');
            }}
            onBlur={() => saveTime(time)}
          />
          {guest.estimated && time === saved && (
            <button
              type="button"
              className={buttonClass}
              disabled={busy || !guest.checkedInAt}
              title="Record the estimated time as their check-in time"
              onClick={() => void onPatch({ checkedInAt: guest.checkedInAt })}
            >
              Confirm
            </button>
          )}
        </span>
        <span className="mt-1 block h-3 font-mono text-[10px] text-white/40" aria-live="polite">
          {timeState === 'saving'
            ? 'Saving…'
            : timeState === 'saved'
              ? 'Saved'
              : timeState === 'future'
                ? "Can't be later than now"
                : ''}
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
            void onPatch({ minutes: minutes === defaultMinutes ? null : minutes });
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

export default GuestCheckIns;
