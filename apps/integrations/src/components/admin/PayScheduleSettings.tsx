// The pay schedule editor in the board's ⚙ Settings panel (admins only):
// how often pay lands, on which days, and where a payday that falls on a
// weekend or bank holiday moves to. Saving shows the next few paydays so the
// effect of a change is visible before anyone notices it on the calendar.

import {
  LAST_DAY_OF_MONTH,
  PAY_FREQUENCIES,
  PAY_FREQUENCY_LABELS,
  PAYDAY_SHIFT_RULE_LABELS,
  PAYDAY_SHIFT_RULES,
  type PaydayShiftRule,
  type PayFrequency,
  type PaySchedule,
} from '@pyre/schedule-core';
import { useEffect, useState } from 'react';
import { compactInputClass, compactSelectClass, goldButtonClass } from '@/components/admin/ui';
import { sendJson } from '@/lib/client/api';
import { useCachedJson } from '@/lib/client/cachedJson';
import { optimistic } from '@/lib/client/optimistic';

interface PayScheduleResponse {
  schedule: PaySchedule | null;
  upcoming: string[];
  error?: string;
}

const PAY_SCHEDULE_URL = '/api/admin/pay-schedule';

const DEFAULT_SCHEDULE: PaySchedule = {
  enabled: true,
  frequency: 'biweekly',
  anchorDate: null,
  daysOfMonth: [],
  shiftRule: 'before',
};

const DAY_OPTIONS = Array.from({ length: LAST_DAY_OF_MONTH }, (_, i) => i + 1);

function dayLabel(day: number): string {
  if (day === LAST_DAY_OF_MONTH) return 'Last day';
  const suffix =
    day % 10 === 1 && day !== 11
      ? 'st'
      : day % 10 === 2 && day !== 12
        ? 'nd'
        : day % 10 === 3 && day !== 13
          ? 'rd'
          : 'th';
  return `${day}${suffix}`;
}

/** '2026-10-26' -> 'Mon Oct 26' */
function formatPayday(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
}

/** Switching cadence keeps what still applies and fills in a sensible start for the rest. */
function withFrequency(draft: PaySchedule, frequency: PayFrequency): PaySchedule {
  if (frequency === 'weekly' || frequency === 'biweekly') {
    return { ...draft, frequency, anchorDate: draft.anchorDate ?? todayLocal() };
  }
  const wanted = frequency === 'monthly' ? 1 : 2;
  const daysOfMonth =
    draft.daysOfMonth.length === wanted
      ? draft.daysOfMonth
      : wanted === 1
        ? [LAST_DAY_OF_MONTH]
        : [15, LAST_DAY_OF_MONTH];
  return { ...draft, frequency, daysOfMonth };
}

export function PayScheduleSettings({ onSaved }: { onSaved: () => void }) {
  // Cached like the rest of the settings panel: reopening it paints the
  // schedule at once. The saved schedule and the next paydays live in the
  // cache entry; the draft is this panel's own.
  const { data, error: loadError, setData } = useCachedJson<PayScheduleResponse>(PAY_SCHEDULE_URL);
  const saved = data?.schedule ?? null;
  const upcoming = data?.upcoming ?? [];
  const [draft, setDraft] = useState<PaySchedule | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The draft starts from the first load only: a revalidation landing
  // mid-edit must not wipe what is being typed.
  useEffect(() => {
    if (data && draft === null) {
      setDraft(data.schedule ?? { ...DEFAULT_SCHEDULE, anchorDate: todayLocal() });
    }
  }, [data, draft]);

  if (!draft) {
    return (
      <p className="font-mono text-xs text-white/40">
        {error ?? loadError ?? 'Loading the pay schedule…'}
      </p>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const weekly = draft.frequency === 'weekly' || draft.frequency === 'biweekly';

  // The draft becomes the schedule the moment Save is pressed; the server's
  // answer brings the paydays it works out from it (the client has no
  // holiday calendar), and a refusal puts the old schedule back.
  const save = async () => {
    const next = draft;
    setBusy(true);
    setError(null);
    const body = await optimistic(
      setData,
      (prev) => (prev ? { ...prev, schedule: next } : prev),
      () => sendJson<PayScheduleResponse>(PAY_SCHEDULE_URL, 'POST', next),
      {
        reconcile: (prev, result) =>
          result.schedule
            ? { ...prev, schedule: result.schedule, upcoming: result.upcoming }
            : prev,
        onError: (message) => setError(message || 'Could not save the pay schedule'),
      }
    );
    setBusy(false);
    if (!body?.schedule) {
      if (body) setError(body.error ?? 'Could not save the pay schedule');
      return;
    }
    setDraft(body.schedule);
    onSaved();
  };

  const setDay = (index: number, day: number) => {
    const days = [...draft.daysOfMonth];
    days[index] = day;
    setDraft({ ...draft, daysOfMonth: days });
  };

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 font-mono text-xs text-white/70">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
        />
        Show paydays on the schedule (and in the calendars of people who choose to include them)
      </label>

      <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-white/70">
        <select
          className={compactSelectClass}
          value={draft.frequency}
          onChange={(e) => setDraft(withFrequency(draft, e.target.value as PayFrequency))}
        >
          {PAY_FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {PAY_FREQUENCY_LABELS[f]}
            </option>
          ))}
        </select>

        {weekly ? (
          <>
            <span>counting from a payday on</span>
            <input
              type="date"
              className={compactInputClass}
              value={draft.anchorDate ?? ''}
              onChange={(e) => setDraft({ ...draft, anchorDate: e.target.value || null })}
            />
          </>
        ) : (
          <>
            <span>on the</span>
            {draft.daysOfMonth.map((day, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: one or two fixed slots
              <span key={i} className="flex items-center gap-2">
                {i > 0 && <span>and the</span>}
                <select
                  className={compactSelectClass}
                  value={day}
                  onChange={(e) => setDay(i, Number(e.target.value))}
                >
                  {DAY_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {dayLabel(d)}
                    </option>
                  ))}
                </select>
              </span>
            ))}
          </>
        )}
      </div>

      <label className="flex flex-wrap items-center gap-2 font-mono text-xs text-white/70">
        On a weekend or bank holiday:
        <select
          className={compactSelectClass}
          value={draft.shiftRule}
          onChange={(e) => setDraft({ ...draft, shiftRule: e.target.value as PaydayShiftRule })}
        >
          {PAYDAY_SHIFT_RULES.map((r) => (
            <option key={r} value={r}>
              {PAYDAY_SHIFT_RULE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={goldButtonClass}
          disabled={busy || !dirty}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save pay schedule'}
        </button>
        {!dirty && saved?.enabled && upcoming.length > 0 && (
          <span className="font-mono text-xs text-white/50">
            Next paydays: {upcoming.map(formatPayday).join(' · ')}
          </span>
        )}
        {!dirty && saved && !saved.enabled && (
          <span className="font-mono text-xs text-white/50">Paydays are hidden.</span>
        )}
      </div>

      {error && <p className="font-mono text-xs text-[var(--pyre-red)]">{error}</p>}
    </div>
  );
}
