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
// Each guest also shows what they're on (lib/guests/plan.ts): credits left,
// their membership, how far into the intro offer they are, and a First visit
// badge for newcomers. Unlimited members are picked out in gold with a star.
//
// The list refetches every half minute; the bars re-run the timing locally
// every few seconds in between. Check out (and its undo) moves the guest at
// once and saves behind it, putting them back if the save fails.
//
// A picker at the top chooses which sessions' guests are shown
// (floor-timing.ts FloorView): the floor as described above, the session
// running now or the next one, a whole day, or a range on the studio clock.
// Guests whose session is behind them — checked out, never checked out, or
// never arrived — are listed under Earlier. The view and the last floor
// loaded are kept in localStorage (floorViewPref.ts, cachedJson's persist),
// so a reload opens where it was left and paints at once, and a Momence
// outage leaves the last-known floor on screen.

import { easternToUtc, todayEastern, utcToEastern } from '@pyre/schedule-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buttonClass, cardClass, compactSelectClass, goldButtonClass } from '@/components/admin/ui';
import { sendJson } from '@/lib/client/api';
import { useCachedJson } from '@/lib/client/cachedJson';
import { etStamp, etTime } from '@/lib/client/format';
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
  type FloorView,
  floorTiming,
  floorViewFields,
  LOOKAHEAD_MINUTES,
  LOOKBACK_MINUTES,
  MINUTE_MS,
  onFloor,
} from '@/lib/guests/floor-timing';
import type { FloorMember, GuestPlan } from '@/lib/guests/plan';
import { FloorViewPicker } from './FloorViewPicker';
import { readFloorViewPref, writeFloorViewPref } from './floorViewPref';
import { FirstVisitBadge, formatDateLabel, formatTimeRange, QuietBadge } from './guestUi';

interface FloorResponse {
  available: boolean;
  now: string;
  view: FloorView;
  /** The instants the view's sessions start between. */
  window: { from: string; to: string };
  checkpoints: Checkpoint[];
  sessionLengths: number[];
  /** What each guest is on, by member id; a guest not looked up yet is missing. */
  members: Record<string, FloorMember>;
  sessions: FloorSession[];
  guests: FloorGuest[];
  complete: boolean;
  error?: string;
}

const FLOOR_URL = '/api/admin/guest-checkins';
const REFETCH_MS = 30_000;
const TICK_MS = 5_000;
/** How old a floor kept in localStorage may be and still paint on a reload. */
const PERSIST_MS = 12 * 60 * 60_000;
/** A typed check-in time saves once it has sat this long (or on blur). */
const TIME_AUTOSAVE_MS = 800;

const BAR_COLORS: Record<FloorStatus, string> = {
  waiting: 'bg-white/20',
  in: 'bg-[var(--pyre-sage)]',
  due: 'bg-[var(--pyre-gold)]',
  over: 'bg-[var(--pyre-red)]',
};

/** Past their end, even while a check-in is due (status is then 'due', not 'over'). */
function isOver(timing: FloorTiming): boolean {
  return timing.endsAt !== null && timing.remainingMs <= 0;
}

function remainingLabel(timing: FloorTiming): string {
  const minutes = Math.ceil(Math.abs(timing.remainingMs) / MINUTE_MS);
  return isOver(timing) ? `Over by ${minutes} min` : `${minutes} min left`;
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

const badgeBase =
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide';
const goldBadge = `${badgeBase} border-[var(--pyre-gold)]/60 bg-[var(--pyre-gold)]/10 text-[var(--pyre-gold)]`;
const sageBadge = `${badgeBase} border-[var(--pyre-sage)]/50 bg-[var(--pyre-sage)]/10 text-[var(--pyre-sage)]`;
const redButtonClass =
  'rounded border border-[var(--pyre-red)]/60 bg-[var(--pyre-red)]/20 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-[var(--pyre-creme)] transition-colors hover:border-[var(--pyre-red)] disabled:opacity-40';
const redBadge = `${badgeBase} border-[var(--pyre-red)]/60 bg-[var(--pyre-red)]/15 text-[var(--pyre-creme)]`;
const quietBadge = `${badgeBase} border-white/10 bg-white/5 text-white/50`;

function StarIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9z" />
    </svg>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "3 credits left", "2 of 4 credits left", "$40 left", or null. */
function creditsLabel(plan: GuestPlan): string | null {
  if (plan.creditsLeft !== null) {
    return plan.kind === 'membership' && plan.creditsTotal
      ? `${plan.creditsLeft} of ${plural(plan.creditsTotal, 'credit')} left`
      : `${plural(plan.creditsLeft, 'credit')} left`;
  }
  if (plan.moneyLeft !== null) return `$${plan.moneyLeft} left`;
  return null;
}

/** "Day 5 of 14", "9 days left", or "Starts today". */
function introLabel(plan: GuestPlan): string {
  const intro = plan.intro;
  if (intro?.day && intro.days) return `Day ${intro.day} of ${intro.days}`;
  if (intro?.daysLeft !== null && intro?.daysLeft !== undefined) {
    return `${plural(intro.daysLeft, 'day')} left`;
  }
  return 'Starts today';
}

/** What a guest is on, as one or two badges (and the intro's progress). */
function PlanBadges({ plan }: { plan: GuestPlan }) {
  const credits = creditsLabel(plan);
  const frozen = plan.frozen ? ' · frozen' : '';
  switch (plan.kind) {
    case 'unlimited':
      return (
        <span className={goldBadge}>
          <StarIcon className="h-3 w-3" />
          {plan.name ?? 'Unlimited'}
          {frozen}
        </span>
      );
    case 'intro': {
      const intro = plan.intro;
      const share = intro?.day && intro.days ? Math.min(1, intro.day / intro.days) : null;
      return (
        <span className={sageBadge} title={plan.name ?? undefined}>
          Intro · {introLabel(plan)}
          {share !== null && (
            <span
              className="relative ml-1 inline-block h-1 w-10 overflow-hidden rounded-full bg-white/15"
              role="progressbar"
              aria-label="Intro offer"
              aria-valuemin={0}
              aria-valuemax={intro?.days ?? 0}
              aria-valuenow={intro?.day ?? 0}
            >
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-[var(--pyre-sage)]"
                style={{ width: `${share * 100}%` }}
              />
            </span>
          )}
        </span>
      );
    }
    case 'membership':
      return (
        <span className={sageBadge}>
          {plan.name ?? 'Member'}
          {credits ? ` · ${credits}` : ''}
          {frozen}
        </span>
      );
    case 'credits':
      return (
        <span
          className={plan.creditsLeft === 0 && !plan.moneyLeft ? redBadge : sageBadge}
          title={plan.name ?? undefined}
        >
          {credits ?? plan.name ?? 'Pack'}
        </span>
      );
    default:
      return <span className={quietBadge}>No credits</span>;
  }
}

/** A guest's name, seats, plan and first-visit badge; gold with a star when unlimited. */
function GuestName({
  guest,
  member,
  className,
}: {
  guest: FloorGuest;
  member: FloorMember | undefined;
  className: string;
}) {
  const unlimited = member?.plan.kind === 'unlimited';
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span
        className={`inline-flex items-center gap-1 ${className} ${unlimited ? 'text-[var(--pyre-gold)]' : ''}`}
      >
        {unlimited && <StarIcon className="h-4 w-4" />}
        {guest.name}
        {unlimited && <span className="sr-only"> (unlimited member)</span>}
      </span>
      {guest.seats > 1 && <QuietBadge>×{guest.seats}</QuietBadge>}
      {member?.firstVisit && <FirstVisitBadge />}
      {member && <PlanBadges plan={member.plan} />}
    </span>
  );
}

/** Gold edge and wash for an unlimited member's card or row. */
function unlimitedClass(member: FloorMember | undefined): string {
  return member?.plan.kind === 'unlimited'
    ? 'border-[var(--pyre-gold)]/70 bg-[var(--pyre-gold)]/[0.06]'
    : '';
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** The route URL for a view; the floor is the bare route. */
function floorUrl(view: FloorView): string {
  const query = new URLSearchParams(floorViewFields(view)).toString();
  return query ? `${FLOOR_URL}?${query}` : FLOOR_URL;
}

/** "Open Hours 6:00 – 8:00 PM" for each of a view's sessions. */
function sessionsLabel(sessions: FloorSession[]): string {
  return sessions.map((s) => `${s.name} ${formatTimeRange(s.startsAt, s.endsAt)}`).join(' · ');
}

/** One line on what the view covers, from what was loaded for it. */
function describeView(view: FloorView, data: FloorResponse | null): string {
  const sessions = data?.sessions ?? [];
  switch (view.kind) {
    case 'floor':
      return `Sessions from the last ${LOOKBACK_MINUTES / 60} hours and the next ${
        LOOKAHEAD_MINUTES === 60 ? 'hour' : `${LOOKAHEAD_MINUTES} minutes`
      }`;
    case 'current':
      if (!data?.available) return 'The session running now, or the next to start';
      if (sessions.length === 0) return 'No session running or coming up';
      return `${Date.parse(sessions[0].startsAt) > Date.now() ? 'Nothing running — next up: ' : ''}${sessionsLabel(sessions)}`;
    case 'next':
      if (!data?.available) return 'The next session to start';
      return sessions.length === 0 ? 'No session coming up' : `Next up: ${sessionsLabel(sessions)}`;
    case 'day':
      return `${formatDateLabel(view.date)}${data?.available ? ` · ${plural(sessions.length, 'session')}` : ''}`;
    case 'custom':
      return `${etStamp(view.from)} – ${etStamp(view.to)}${data?.available ? ` · ${plural(sessions.length, 'session')}` : ''}`;
  }
}

export function GuestCheckIns() {
  const today = useMemo(() => todayEastern(), []);
  // Null until the saved view is read after mount: the island is
  // server-rendered, where there is no storage, and the first fetch should
  // be for the view that will be shown.
  const [view, setView] = useState<FloorView | null>(null);
  useEffect(() => {
    setView(readFloorViewPref());
  }, []);
  const floor = useCachedJson<FloorResponse>(view ? floorUrl(view) : null, {
    maxAgeMs: 60_000,
    persist: true,
    persistMaxAgeMs: PERSIST_MS,
  });
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'error' | 'warn' } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Check-outs (and undos) shown before the server has them, by booking id:
  // the time they left, or null for an undo.
  const [leaving, setLeaving] = useState<Record<string, string | null>>({});

  const { reload, setData } = floor;
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

  const members = floor.data?.members ?? {};
  const memberOf = (guest: FloorGuest) => (guest.memberId ? members[guest.memberId] : undefined);
  const guests = (floor.data?.guests ?? []).map((g) =>
    g.bookingId in leaving ? { ...g, checkedOutAt: leaving[g.bookingId] } : g
  );
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
  // Everyone else: checked out, time long up and never checked out, or
  // never arrived for a session that has ended. Latest first.
  const listed = new Set([
    ...inside.map(({ guest }) => guest.bookingId),
    ...waiting.map((g) => g.bookingId),
  ]);
  const lastSeen = (g: FloorGuest) =>
    g.checkedOutAt ?? g.checkedInAt ?? sessions.get(g.sessionId)?.startsAt ?? '';
  const earlier = guests
    .filter((g) => !listed.has(g.bookingId))
    .sort((a, b) => lastSeen(b).localeCompare(lastSeen(a)) || a.name.localeCompare(b.name));
  const dueNow = inside.filter(({ timing }) => timing.status === 'due');

  const changeView = (next: FloorView) => {
    setView(next);
    writeFloorViewPref(next);
    setEditing(null);
    setNotice(null);
  };

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

  // Every change names the view, so the route checks the booking against the
  // same sessions the page is showing.
  const ids = (guest: FloorGuest) => ({
    sessionId: guest.sessionId,
    bookingId: guest.bookingId,
    ...(view ? floorViewFields(view) : {}),
  });

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

  /**
   * Check a guest out (or undo it) at once, then save. The saved row goes
   * straight into the floor data, so the guest stays put without waiting on
   * a full refetch; a failed save puts them back where they were.
   */
  async function setCheckedOut(guest: FloorGuest, out: boolean) {
    const key = guest.bookingId;
    setEditing(null);
    setNotice(null);
    setLeaving((current) => ({ ...current, [key]: out ? new Date().toISOString() : null }));
    try {
      const { checkin } = await sendJson<{ checkin: { checked_out_at: string | null } }>(
        FLOOR_URL,
        'PATCH',
        {
          ...ids(guest),
          ...(guest.estimated && { checkedInAt: guest.checkedInAt }),
          checkedOut: out,
        }
      );
      setData((prev) =>
        prev
          ? {
              ...prev,
              guests: prev.guests.map((g) =>
                g.bookingId === key
                  ? { ...g, checkedOutAt: checkin.checked_out_at, estimated: false }
                  : g
              ),
            }
          : prev
      );
      void reload();
    } catch (e) {
      setNotice({
        tone: 'error',
        text: `${out ? 'Check-out' : 'Undo'} for ${guest.name} didn't save: ${
          e instanceof Error ? e.message : String(e)
        }`,
      });
    } finally {
      setLeaving((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  const undo = (guest: FloorGuest) => {
    if (!window.confirm(`Undo ${guest.name}'s check-in? This also un-checks them in Momence.`)) {
      return;
    }
    setEditing(null);
    void act(guest, () => sendJson(`${FLOOR_URL}?${new URLSearchParams(ids(guest))}`, 'DELETE'));
  };

  return (
    <div className="space-y-6">
      {view && <FloorViewPicker view={view} today={today} onChange={changeView} />}
      {view && <p className="font-mono text-xs text-white/45">{describeView(view, floor.data)}</p>}

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
        <p className="text-sm text-[var(--pyre-red)]">
          {floor.data
            ? `Couldn't refresh the floor: ${floor.error}. Showing it as of ${etTime(floor.data.now)}.`
            : `Couldn't load the floor: ${floor.error}`}
        </p>
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
            <p className="text-sm text-white/60">
              {view?.kind === 'floor' || view?.kind === 'current'
                ? 'Nobody is checked in right now.'
                : 'Nobody from these sessions is checked in right now.'}
            </p>
          </div>
        )}
        <ul className="space-y-2">
          {inside.map(({ guest, timing }) => (
            <li
              key={guest.bookingId}
              className={`${cardClass} ${
                unlimitedClass(memberOf(guest)) ||
                (timing.checkpoints.some((c) => c.overdue)
                  ? 'border-[var(--pyre-red)]/70'
                  : timing.status === 'due'
                    ? 'border-[var(--pyre-gold)]/60'
                    : '')
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <GuestName
                    guest={guest}
                    member={memberOf(guest)}
                    className="text-base font-primary-semibold text-[var(--pyre-creme)]"
                  />
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
                      isOver(timing)
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
                  onClick={() => void setCheckedOut(guest, true)}
                >
                  Check out
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
            {view?.kind === 'floor'
              ? 'No one else is booked into a current or upcoming session.'
              : 'No one else is booked into a session still to come.'}
          </p>
        )}
        <ul className="divide-y divide-white/5 rounded border border-white/10 bg-white/[0.03]">
          {waiting.map((guest) => {
            const session = sessions.get(guest.sessionId);
            return (
              <li
                key={guest.bookingId}
                className={`flex items-center justify-between gap-3 border-l-2 border-transparent p-3 ${unlimitedClass(memberOf(guest))}`}
              >
                <div className="min-w-0">
                  <GuestName
                    guest={guest}
                    member={memberOf(guest)}
                    className="text-sm font-primary-semibold text-[var(--pyre-creme)]"
                  />
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

      {earlier.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-mono text-xs uppercase tracking-wide text-white/50">
            Earlier · {earlier.length}
          </h2>
          <ul className="divide-y divide-white/5 rounded border border-white/10 bg-white/[0.03]">
            {earlier.map((guest) => {
              const session = sessions.get(guest.sessionId);
              const where = session ? `${session.name} · ${etTime(session.startsAt)}` : 'Session';
              const stayed =
                guest.checkedInAt && guest.checkedOutAt
                  ? Math.round(
                      (Date.parse(guest.checkedOutAt) - Date.parse(guest.checkedInAt)) / MINUTE_MS
                    )
                  : null;
              return (
                <li key={guest.bookingId} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <GuestName
                      guest={guest}
                      member={memberOf(guest)}
                      className="text-sm text-white/70"
                    />
                    <span className="mt-0.5 block font-mono text-xs text-white/40">
                      {guest.checkedOutAt ? (
                        <>
                          {guest.checkedInAt ? etTime(guest.checkedInAt) : '—'} –{' '}
                          {etTime(guest.checkedOutAt)}
                          {stayed !== null ? ` · ${stayed} of ${guest.minutes} min` : ''}
                        </>
                      ) : guest.checkedIn ? (
                        <>
                          In {guest.checkedInAt ? etTime(guest.checkedInAt) : '—'}
                          {guest.estimated ? ' (est.)' : ''} · {guest.minutes} min · not checked out
                        </>
                      ) : (
                        <>Didn't check in</>
                      )}
                      {' · '}
                      {where}
                    </span>
                  </div>
                  {guest.checkedOutAt && (
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={busy === guest.bookingId || guest.bookingId in leaving}
                      onClick={() => void setCheckedOut(guest, false)}
                    >
                      Undo check-out
                    </button>
                  )}
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
 * them done, red once the next check-in has come due too; done ones say when, and tap again to un-mark; upcoming ones say
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
  const { checkpoint, done, due, overdue, dueAt } = timing;
  if (due) {
    return (
      <button
        type="button"
        className={overdue ? redButtonClass : goldButtonClass}
        disabled={busy}
        onClick={onToggle}
      >
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
    // On the day they checked in, which is today unless a past day is open.
    const at = easternToUtc(
      guest.checkedInAt ? utcToEastern(guest.checkedInAt).date : todayEastern(),
      value
    );
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
