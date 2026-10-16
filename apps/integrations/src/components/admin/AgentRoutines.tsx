// The routines page: requests saved for Pyre Agent to run on a cadence. Each
// row says what it asks, when it runs next, and how its last run went, with
// a link to that answer; a form makes or edits one (starting from a preset
// if wanted), and Run now starts one on the spot and opens its conversation
// on the Pyre Agent page, where the answer streams in. Arriving with
// ?prompt= (the "Save as routine" link on a question) opens the form with it.

import { useEffect, useState } from 'react';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import { readError } from '@/lib/client/api';
import { useCachedJson } from '@/lib/client/cachedJson';
import {
  type Cadence,
  describeCadence,
  type Frequency,
  formatHour,
  nextRunAt,
  ROUTINE_LIMITS,
  ROUTINE_PRESETS,
  type RoutineView,
  WEEKDAY_NAMES,
} from '@/lib/pyre-agent/cadence';
import { writeStored } from '@/lib/pyre-agent/conversation';

const URL_ROUTINES = '/api/admin/agent-routines';

interface Payload {
  routines: RoutineView[];
}

interface Draft {
  id: string | null;
  title: string;
  prompt: string;
  cadence: Cadence;
}

const EMPTY_DRAFT: Draft = {
  id: null,
  title: '',
  prompt: '',
  cadence: { frequency: 'weekly', weekdays: [1], monthDay: 1, hour: 8 },
};

const buttonClass =
  'rounded border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-mono uppercase tracking-wide text-white/70 transition-colors hover:border-white/30 hover:text-white disabled:opacity-40';
const goldButtonClass =
  'rounded border border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 px-3 py-1.5 text-xs font-mono uppercase tracking-wide text-[var(--pyre-gold)] transition-colors hover:border-[var(--pyre-gold)] disabled:opacity-40';
const inputClass =
  'w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm text-[var(--pyre-creme)] placeholder-white/30 focus:border-white/30 focus:outline-none';
const labelClass = 'mb-1 block font-mono text-[11px] uppercase tracking-wide text-white/50';

/** "Mon, Oct 20, 8:00 AM" on the studio's clock. */
function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MONTH_DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

const RUN_STATUS: Record<'running' | 'answered' | 'failed', string> = {
  running: 'Running',
  answered: 'Answered',
  failed: 'Failed',
};

export function AgentRoutines() {
  const routines = useCachedJson<Payload>(URL_ROUTINES);
  const list = routines.data?.routines ?? [];
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // "Save as routine" from a question on the Pyre Agent page.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prompt = params.get('prompt')?.trim();
    if (!prompt) return;
    setDraft({
      ...EMPTY_DRAFT,
      title: prompt.split(/\r?\n/)[0].slice(0, 60),
      prompt: prompt.slice(0, ROUTINE_LIMITS.prompt),
    });
    params.delete('prompt');
    const rest = params.toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${rest ? `?${rest}` : ''}`
    );
  }, []);

  const replace = (routine: RoutineView) =>
    routines.setData((prev) => ({
      routines: (prev?.routines ?? []).some((r) => r.id === routine.id)
        ? (prev?.routines ?? []).map((r) => (r.id === routine.id ? routine : r))
        : [...(prev?.routines ?? []), routine],
    }));

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(URL_ROUTINES, {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(draft.id ? { id: draft.id } : {}),
          title: draft.title,
          prompt: draft.prompt,
          frequency: draft.cadence.frequency,
          weekdays: draft.cadence.weekdays,
          monthDay: draft.cadence.monthDay,
          hour: draft.cadence.hour,
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      replace(((await res.json()) as { routine: RoutineView }).routine);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the routine');
    } finally {
      setSaving(false);
    }
  };

  const setEnabled = async (routine: RoutineView, enabled: boolean) => {
    setWorkingId(routine.id);
    setError(null);
    try {
      const res = await fetch(URL_ROUTINES, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: routine.id, enabled }),
      });
      if (!res.ok) throw new Error(await readError(res));
      replace(((await res.json()) as { routine: RoutineView }).routine);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the routine');
    } finally {
      setWorkingId(null);
    }
  };

  const remove = async (routine: RoutineView) => {
    if (
      !window.confirm(`Delete "${routine.title}"? Its past answers stay in your conversations.`)
    ) {
      return;
    }
    setWorkingId(routine.id);
    setError(null);
    try {
      const res = await fetch(`${URL_ROUTINES}?id=${encodeURIComponent(routine.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(await readError(res));
      routines.setData((prev) => ({
        routines: (prev?.routines ?? []).filter((r) => r.id !== routine.id),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the routine');
    } finally {
      setWorkingId(null);
    }
  };

  const runNow = async (routine: RoutineView) => {
    setWorkingId(routine.id);
    setError(null);
    try {
      const res = await fetch(URL_ROUTINES, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run', id: routine.id }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as { sessionId: string; token: string | null };
      // Open it on the Pyre Agent page, which streams the answer in.
      if (body.token) {
        writeStored({ sessionId: body.sessionId, token: body.token, pending: routine.prompt });
      }
      window.location.href = `/admin/ask?c=${encodeURIComponent(body.sessionId)}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not run the routine');
      setWorkingId(null);
    }
  };

  const nextPreview = draft ? nextRunAt(draft.cadence, new Date()) : null;
  const setCadence = (patch: Partial<Cadence>) =>
    setDraft((d) => (d ? { ...d, cadence: { ...d.cadence, ...patch } } : d));

  return (
    <div className="space-y-6">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {routines.error && <ErrorBanner>{routines.error}</ErrorBanner>}

      {draft ? (
        <form
          className="space-y-4 rounded border border-white/10 bg-white/[0.03] p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h2 className="font-mono text-xs uppercase tracking-wide text-[var(--pyre-gold)]">
            {draft.id ? 'Edit routine' : 'New routine'}
          </h2>
          {!draft.id && (
            <div>
              <span className={labelClass}>Start from</span>
              <div className="flex flex-wrap gap-2">
                {ROUTINE_PRESETS.map((preset) => (
                  <button
                    key={preset.title}
                    type="button"
                    className={buttonClass}
                    onClick={() =>
                      setDraft({ id: null, ...preset, cadence: { ...preset.cadence } })
                    }
                  >
                    {preset.title}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <label htmlFor="routine-title" className={labelClass}>
              Name
            </label>
            <input
              id="routine-title"
              className={inputClass}
              value={draft.title}
              maxLength={ROUTINE_LIMITS.title}
              placeholder="Weekly shift notes summary"
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="routine-prompt" className={labelClass}>
              What to ask Pyre Agent
            </label>
            <textarea
              id="routine-prompt"
              className={`${inputClass} min-h-32`}
              value={draft.prompt}
              maxLength={ROUTINE_LIMITS.prompt}
              placeholder="Summarize every shift note from the past week for our team update…"
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-white/35">
              It runs as you, from what you can see when it runs, and nobody is there to answer
              follow-up questions, so say everything it needs. {draft.prompt.length}/
              {ROUTINE_LIMITS.prompt}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="routine-frequency" className={labelClass}>
                Repeats
              </label>
              <select
                id="routine-frequency"
                className={inputClass}
                value={draft.cadence.frequency}
                onChange={(e) => setCadence({ frequency: e.target.value as Frequency })}
              >
                <option value="daily">Every day</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            {draft.cadence.frequency === 'monthly' && (
              <div>
                <label htmlFor="routine-day" className={labelClass}>
                  Day of the month
                </label>
                <select
                  id="routine-day"
                  className={inputClass}
                  value={draft.cadence.monthDay ?? 1}
                  onChange={(e) => setCadence({ monthDay: Number(e.target.value) })}
                >
                  {MONTH_DAYS.map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="routine-hour" className={labelClass}>
                At (Eastern)
              </label>
              <select
                id="routine-hour"
                className={inputClass}
                value={draft.cadence.hour}
                onChange={(e) => setCadence({ hour: Number(e.target.value) })}
              >
                {HOURS.map((hour) => (
                  <option key={hour} value={hour}>
                    {formatHour(hour)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {draft.cadence.frequency === 'weekly' && (
            <fieldset>
              <legend className={labelClass}>On</legend>
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_NAMES.map((name, day) => {
                  const on = draft.cadence.weekdays.includes(day);
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={on}
                      className={on ? goldButtonClass : buttonClass}
                      onClick={() =>
                        setCadence({
                          weekdays: on
                            ? draft.cadence.weekdays.filter((d) => d !== day)
                            : [...draft.cadence.weekdays, day].sort((a, b) => a - b),
                        })
                      }
                    >
                      {name.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
          <p className="text-xs text-white/50">
            {draft.cadence.frequency === 'weekly' && draft.cadence.weekdays.length === 0
              ? 'Pick at least one day.'
              : `${describeCadence(draft.cadence)}${nextPreview ? ` — next run ${formatWhen(nextPreview)}` : ''}`}
          </p>
          <div className="flex gap-2">
            <button
              type="submit"
              className={goldButtonClass}
              disabled={saving || !draft.title.trim() || !draft.prompt.trim()}
            >
              {saving ? 'Saving…' : draft.id ? 'Save' : 'Create routine'}
            </button>
            <button type="button" className={buttonClass} onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <a
            href="/admin/ask"
            className="font-mono text-[11px] uppercase tracking-wide text-white/50 hover:text-white"
          >
            ← Pyre Agent
          </a>
          <button type="button" className={goldButtonClass} onClick={() => setDraft(EMPTY_DRAFT)}>
            New routine
          </button>
        </div>
      )}

      {routines.loading ? (
        <p className="font-mono text-xs uppercase tracking-wide text-white/40">Loading…</p>
      ) : list.length === 0 ? (
        !draft && (
          <div className="rounded border border-white/10 bg-white/[0.03] p-6 text-center">
            <p className="text-sm text-white/60">
              No routines yet. Save a request — like a Monday summary of last week's shift notes for
              the team update — and Pyre Agent will run it for you on a schedule.
            </p>
            <button
              type="button"
              className={`${goldButtonClass} mt-4`}
              onClick={() =>
                setDraft({
                  id: null,
                  ...ROUTINE_PRESETS[0],
                  cadence: { ...ROUTINE_PRESETS[0].cadence },
                })
              }
            >
              Start with the weekly shift notes summary
            </button>
          </div>
        )
      ) : (
        <ul className="space-y-3">
          {list.map((routine) => {
            const working = workingId === routine.id;
            return (
              <li
                key={routine.id}
                className={`rounded border border-white/10 bg-white/[0.03] p-4 ${routine.enabled ? '' : 'opacity-70'}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm text-[var(--pyre-creme)]">{routine.title}</h3>
                    <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wide text-white/45">
                      {describeCadence(routine.cadence)}
                      {routine.enabled
                        ? routine.nextRunAt
                          ? ` · next ${formatWhen(routine.nextRunAt)}`
                          : ''
                        : ' · paused'}
                    </p>
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-white/60">
                      {routine.prompt}
                    </p>
                    {routine.lastRun && (
                      <p className="mt-2 text-xs text-white/50">
                        Last run {formatWhen(routine.lastRun.startedAt)}:{' '}
                        <span
                          className={
                            routine.lastRun.status === 'failed'
                              ? 'text-[var(--pyre-red)]'
                              : routine.lastRun.status === 'answered'
                                ? 'text-emerald-300/90'
                                : 'text-white/70'
                          }
                        >
                          {RUN_STATUS[routine.lastRun.status]}
                        </span>
                        {routine.lastRun.sessionId && (
                          <>
                            {' — '}
                            <a
                              className="text-[var(--pyre-gold)] hover:underline"
                              href={`/admin/ask?c=${encodeURIComponent(routine.lastRun.sessionId)}`}
                            >
                              open the answer
                            </a>
                          </>
                        )}
                        {routine.lastRun.status === 'failed' && routine.lastRun.error && (
                          <span className="block text-[var(--pyre-red)]/80">
                            {routine.lastRun.error}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={goldButtonClass}
                      disabled={working}
                      onClick={() => void runNow(routine)}
                    >
                      {working ? 'Working…' : 'Run now'}
                    </button>
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={working}
                      onClick={() =>
                        setDraft({
                          id: routine.id,
                          title: routine.title,
                          prompt: routine.prompt,
                          cadence: {
                            ...routine.cadence,
                            monthDay: routine.cadence.monthDay ?? 1,
                          },
                        })
                      }
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={working}
                      onClick={() => void setEnabled(routine, !routine.enabled)}
                    >
                      {routine.enabled ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={working}
                      onClick={() => void remove(routine)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
