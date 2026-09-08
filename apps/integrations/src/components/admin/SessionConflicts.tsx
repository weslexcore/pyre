// The special-event conflict review (/admin/session-conflicts, admin only).
//
// One open review at a time: each special event is a card, each regular
// session under it a checkbox row. Open Hours and Social rows start ticked;
// anything else starts unticked, so nothing gets cancelled by a default.
// "Cancel N selected" confirms once, then cancels in Momence through the
// review API and paints the outcome on each row. "Check now" re-reads
// Momence into the same review, so a special event added on Wednesday shows
// up without waiting for Monday.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import type { SessionConflictReviewRow } from '@/lib/db';
import {
  type CancelSupport,
  type ConflictSession,
  isHandled,
  type ResolutionEntry,
  type SessionConflict,
} from '@/lib/session-conflicts/types';
import { ConfirmDialog } from './ConfirmDialog';
import { buttonClass, cardClass, primaryButtonClass } from './incidentUi';

const API = '/api/admin/session-conflicts';

interface StateResponse {
  pending: SessionConflictReviewRow | null;
  history: SessionConflictReviewRow[];
  lastCheckedAt: string | null;
  cancelSupport: CancelSupport;
  horizonDays: number;
}

const TIME_ZONE = 'America/New_York';

const dayLabel = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: TIME_ZONE,
  });

const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TIME_ZONE,
  });

const sameDay = (a: string, b: string): boolean =>
  new Date(a).toLocaleDateString('en-US', { timeZone: TIME_ZONE }) ===
  new Date(b).toLocaleDateString('en-US', { timeZone: TIME_ZONE });

/** "Thu, Sep 17 · 7:00 PM – 9:00 PM" (the end carries its day when it differs). */
const whenLabel = (startsAt: string, endsAt: string): string =>
  `${dayLabel(startsAt)} · ${clock(startsAt)} – ${
    sameDay(startsAt, endsAt) ? clock(endsAt) : `${dayLabel(endsAt)} ${clock(endsAt)}`
  }`;

const timestamp = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TIME_ZONE,
  });

/** An ET calendar date (YYYY-MM-DD) as "Oct 12". */
const calendarDate = (date: string): string =>
  new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const typeLabel = (type: string): string => type.charAt(0).toUpperCase() + type.slice(1);

const bookingLabel = (s: ConflictSession): string =>
  s.bookingCount === null ? '' : s.bookingCount === 0 ? 'No bookings' : `${s.bookingCount} booked`;

const OUTCOME_STYLE: Record<ResolutionEntry['outcome'], { label: string; className: string }> = {
  cancelled: { label: 'Cancelled', className: 'text-[var(--pyre-sage)]' },
  cleared: { label: 'Cleared', className: 'text-white/50' },
  skipped: { label: 'Left in place', className: 'text-white/50' },
  failed: { label: 'Failed', className: 'text-[var(--pyre-red)]' },
  unsupported: { label: 'Needs Momence', className: 'text-[var(--pyre-gold)]' },
};

const STATUS_LABEL: Record<SessionConflictReviewRow['status'], string> = {
  pending: 'Open',
  resolved: 'Resolved',
  clear: 'Nothing found',
  superseded: 'Replaced',
};

/** Distinct sessions across the groups, first occurrence wins. */
function uniqueSessions(conflicts: SessionConflict[]): ConflictSession[] {
  const seen = new Map<number, ConflictSession>();
  for (const g of conflicts) for (const s of g.sessions) if (!seen.has(s.id)) seen.set(s.id, s);
  return [...seen.values()];
}

function OutcomeBadge({ entry }: { entry: ResolutionEntry }) {
  const style = OUTCOME_STYLE[entry.outcome];
  return (
    <span
      className={`font-mono text-xs uppercase tracking-wide ${style.className}`}
      title={entry.message}
    >
      {style.label}
    </span>
  );
}

function SessionRow({
  session,
  entry,
  checked,
  disabled,
  onToggle,
}: {
  session: ConflictSession;
  entry: ResolutionEntry | undefined;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const handled = isHandled(entry);
  const inputId = `session-${session.id}`;
  return (
    <li className="flex items-start gap-3 py-2">
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        disabled={disabled || handled}
        onChange={onToggle}
        className="mt-1 h-4 w-4 accent-[var(--pyre-red)]"
      />
      <label htmlFor={inputId} className={`flex-1 ${handled ? 'opacity-60' : ''}`}>
        <span className="block text-sm text-[var(--pyre-creme)]">
          {session.title}
          <span className="ml-2 font-mono text-xs uppercase tracking-wide text-white/40">
            {typeLabel(session.type)}
          </span>
        </span>
        <span className="block text-xs text-white/55">
          {whenLabel(session.startsAt, session.endsAt)}
          {bookingLabel(session) ? ` · ${bookingLabel(session)}` : ''}
          {session.link && (
            <>
              {' · '}
              <a href={session.link} target="_blank" rel="noreferrer" className="underline">
                Momence
              </a>
            </>
          )}
        </span>
        {entry && (
          <span className="mt-0.5 block text-xs">
            <OutcomeBadge entry={entry} />
            {entry.message && entry.outcome !== 'skipped' && (
              <span className="ml-2 text-white/50">{entry.message}</span>
            )}
          </span>
        )}
      </label>
    </li>
  );
}

export function SessionConflicts() {
  const { data, error, loading, refreshing, reload, setData } = useCachedJson<StateResponse>(API);
  const review = data?.pending ?? null;
  const cancelSupport = data?.cancelSupport ?? 'unknown';

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'cancel' | 'check' | 'dismiss' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Default selection: the pre-selected (Open Hours / Social) rows that are
  // still undecided. Re-derived whenever the review changes underneath us.
  useEffect(() => {
    if (!review) {
      setSelected(new Set());
      return;
    }
    setSelected(
      new Set(
        uniqueSessions(review.conflicts)
          .filter((s) => s.preselected && !isHandled(review.resolution[String(s.id)]))
          .map((s) => s.id)
      )
    );
  }, [review]);

  const sessions = useMemo(() => (review ? uniqueSessions(review.conflicts) : []), [review]);
  const undecided = sessions.filter((s) => !isHandled(review?.resolution[String(s.id)]));
  const selectedSessions = undecided.filter((s) => selected.has(s.id));
  const bookedAmongSelected = selectedSessions.reduce((n, s) => n + (s.bookingCount ?? 0), 0);

  const post = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string } & Record<
      string,
      unknown
    >;
    if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
    return payload;
  }, []);

  const refreshState = useCallback(async () => {
    invalidateJson(API);
    await reload();
  }, [reload]);

  const check = async () => {
    setBusy('check');
    setActionError(null);
    setNotice(null);
    try {
      const result = (await post({ action: 'check' })) as { detected: number };
      setNotice(
        result.detected === 0
          ? 'Checked Momence — nothing overlaps a special event.'
          : `Checked Momence — ${result.detected} session${result.detected === 1 ? '' : 's'} overlap a special event.`
      );
      await refreshState();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Check failed');
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    if (!review) return;
    setConfirming(false);
    setBusy('cancel');
    setActionError(null);
    setNotice(null);
    try {
      const result = (await post({
        action: 'cancel',
        reviewId: review.id,
        sessionIds: selectedSessions.map((s) => s.id),
      })) as {
        review: SessionConflictReviewRow;
        outcomes: Record<string, ResolutionEntry>;
        cancelSupport: CancelSupport;
        outOfTime: boolean;
      };
      const counts = Object.values(result.outcomes).reduce<Record<string, number>>((acc, e) => {
        acc[e.outcome] = (acc[e.outcome] ?? 0) + 1;
        return acc;
      }, {});
      const parts = [
        counts.cancelled && `${counts.cancelled} cancelled in Momence`,
        counts.cleared && `${counts.cleared} already gone`,
        counts.failed && `${counts.failed} failed`,
        counts.unsupported && `${counts.unsupported} need cancelling in the Momence dashboard`,
      ].filter(Boolean);
      setNotice(
        `${parts.join(', ') || 'Nothing changed'}${result.outOfTime ? ' — ran out of time, press again for the rest' : ''}. The shift board catches up on the next hourly sync.`
      );
      setData((prev) =>
        prev
          ? {
              ...prev,
              pending: result.review.status === 'pending' ? result.review : null,
              cancelSupport: result.cancelSupport,
            }
          : prev
      );
      await refreshState();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async () => {
    if (!review) return;
    setBusy('dismiss');
    setActionError(null);
    setNotice(null);
    try {
      await post({ action: 'dismiss', reviewId: review.id });
      setNotice('Marked as handled.');
      await refreshState();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not mark as handled');
    } finally {
      setBusy(null);
    }
  };

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectPreselected = () =>
    setSelected(new Set(undecided.filter((s) => s.preselected).map((s) => s.id)));

  const canCancel = cancelSupport !== 'unsupported';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonClass} onClick={check} disabled={busy !== null}>
          {busy === 'check' ? 'Checking Momence…' : 'Check now'}
        </button>
        {data?.lastCheckedAt && (
          <span className="font-mono text-xs text-white/40">
            Last checked {timestamp(data.lastCheckedAt)}
            {data.horizonDays ? ` · looks ${data.horizonDays} days ahead` : ''}
          </span>
        )}
        {refreshing && <span className="font-mono text-xs text-white/35">Refreshing…</span>}
      </div>

      {error && <p className="text-sm text-[var(--pyre-red)]">Couldn't load: {error}</p>}
      {actionError && <p className="text-sm text-[var(--pyre-red)]">{actionError}</p>}
      {notice && <p className="text-sm text-[var(--pyre-sage)]">{notice}</p>}
      {loading && <p className="font-mono text-xs text-white/40">Loading…</p>}

      {cancelSupport === 'unsupported' && (
        <div className={`${cardClass} border-[var(--pyre-gold)]/40`}>
          <p className="text-sm text-[var(--pyre-creme)]">
            Momence does not let this account cancel sessions through its API. Open each session
            below in Momence, cancel it there, then press <strong>Mark as handled</strong>.
          </p>
        </div>
      )}

      {!loading && !review && (
        <div className={cardClass}>
          <p className="text-sm text-[var(--pyre-creme)]">
            Nothing overlaps a special event
            {data?.horizonDays ? ` in the next ${data.horizonDays} days` : ''}.
          </p>
          <p className="mt-1 text-xs text-white/50">
            The check runs every Monday morning and emails the admins when it finds something. Added
            a special event since? Press Check now.
          </p>
        </div>
      )}

      {review && (
        <>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-xs text-white/50">
            <span>
              {sessions.length} session{sessions.length === 1 ? '' : 's'} under{' '}
              {review.conflicts.length} special event{review.conflicts.length === 1 ? '' : 's'}
            </span>
            <span>
              {calendarDate(review.horizon_start)} – {calendarDate(review.horizon_end)}
            </span>
            <span>
              {review.source === 'cron' ? 'Monday check' : `Checked by ${review.created_by}`}
            </span>
            {review.notified_at && (
              <span>
                Emailed {review.notified_count} admin{review.notified_count === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {review.conflicts.map((group) => (
            <section key={group.specialEvent.id} className={cardClass}>
              <h2 className="font-primary-semibold text-base text-[var(--pyre-creme)]">
                {group.specialEvent.title}
              </h2>
              <p className="text-xs text-white/55">
                {whenLabel(group.specialEvent.startsAt, group.specialEvent.endsAt)}
                {group.specialEvent.location ? ` · ${group.specialEvent.location}` : ''}
                {group.specialEvent.link && (
                  <>
                    {' · '}
                    <a
                      href={group.specialEvent.link}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      Momence
                    </a>
                  </>
                )}
              </p>
              <ul className="mt-2 divide-y divide-white/5">
                {group.sessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    entry={review.resolution[String(session.id)]}
                    checked={selected.has(session.id)}
                    disabled={busy !== null || !canCancel}
                    onToggle={() => toggle(session.id)}
                  />
                ))}
              </ul>
            </section>
          ))}

          <div className="flex flex-wrap items-center gap-3">
            {canCancel && (
              <button
                type="button"
                className={primaryButtonClass}
                disabled={busy !== null || selectedSessions.length === 0}
                onClick={() => setConfirming(true)}
              >
                {busy === 'cancel'
                  ? 'Cancelling…'
                  : `Cancel ${selectedSessions.length} selected in Momence`}
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                className={buttonClass}
                disabled={busy !== null}
                onClick={selectPreselected}
              >
                Select Open Hours + Social
              </button>
            )}
            <button
              type="button"
              className={buttonClass}
              disabled={busy !== null}
              onClick={dismiss}
            >
              {busy === 'dismiss' ? 'Saving…' : 'Mark as handled'}
            </button>
          </div>
          <p className="text-xs text-white/40">
            Cancelling tells Momence to cancel the session; anyone booked gets Momence's
            cancellation notice. Unticked sessions are left in place.
          </p>
        </>
      )}

      {data && data.history.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-mono text-xs uppercase tracking-wide text-white/50">
            Past checks
          </summary>
          <ul className="mt-2 space-y-1">
            {data.history.map((row) => (
              <li key={row.id} className="flex flex-wrap gap-x-3 text-xs text-white/60">
                <span className="text-white/40">{timestamp(row.created_at)}</span>
                <span className="text-[var(--pyre-creme)]">{STATUS_LABEL[row.status]}</span>
                <span>
                  {row.session_count} session{row.session_count === 1 ? '' : 's'}
                </span>
                <span>{row.source === 'cron' ? 'Monday check' : `by ${row.created_by}`}</span>
                {row.resolved_by && <span>closed by {row.resolved_by}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {confirming && review && (
        <ConfirmDialog
          title={`Cancel ${selectedSessions.length} session${selectedSessions.length === 1 ? '' : 's'} in Momence?`}
          body={
            bookedAmongSelected > 0
              ? `These have ${bookedAmongSelected} booking${bookedAmongSelected === 1 ? '' : 's'} between them. Momence will cancel the sessions and let those guests know.`
              : 'Nobody is booked into these yet. Momence will cancel them.'
          }
          confirmLabel={`Cancel ${selectedSessions.length} session${selectedSessions.length === 1 ? '' : 's'}`}
          danger
          busy={busy === 'cancel'}
          onConfirm={cancel}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
