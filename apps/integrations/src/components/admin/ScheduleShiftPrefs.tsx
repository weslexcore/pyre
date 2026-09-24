// Scheduling preferences on the Hours tab: each person's h/wk target and
// shifts-per-week range (min / preferred / max), which the AI drafter plans
// around. Managers get a table of everyone on the roster; everyone else gets
// a card for their own row. Rows come from the schedule-board payload the
// Hours tab already loads. Edits save themselves: a row goes to
// /api/admin/staff-preferences shortly after the last keystroke, or as soon as
// the field loses focus.

import { useEffect, useRef, useState } from 'react';
import { invalidateJson } from '@/lib/client/cachedJson';
import type { StaffRow } from '@/lib/db';

const inputClass =
  'px-2 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30';

/** A row's typed-but-unsaved values, as the inputs hold them. */
interface PrefsDraft {
  targetHours: string;
  minShifts: string;
  preferredShifts: string;
  maxShifts: string;
}

const draftFor = (s: StaffRow): PrefsDraft => ({
  targetHours: String(s.target_hours_per_week ?? ''),
  minShifts: String(s.min_shifts_per_week ?? ''),
  preferredShifts: String(s.preferred_shifts_per_week ?? ''),
  maxShifts: String(s.max_shifts_per_week ?? ''),
});

/**
 * The inputs, in reading order; keys match the PATCH body. `help` speaks to
 * the person editing their own week; `note` is the short version under each
 * column heading on the manager's table.
 */
const FIELDS: Array<{
  key: keyof PrefsDraft;
  title: string;
  unit: string;
  help: string;
  note: string;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  // {
  //   key: 'targetHours',
  //   title: 'Weekly hours',
  //   unit: 'hrs',
  //   help: 'How many hours a week you would like to work.',
  //   note: 'hours they want',
  //   label: 'target hours per week',
  //   min: 0,
  //   max: 168,
  //   step: 0.5,
  // },
  {
    key: 'minShifts',
    title: 'Fewest shifts',
    unit: 'shifts',
    help: 'The fewest shifts a week you need. We fill these first.',
    note: 'filled first',
    label: 'minimum shifts per week',
    min: 0,
    max: 14,
    step: 1,
  },
  {
    key: 'preferredShifts',
    title: 'Ideal shifts',
    unit: 'shifts',
    help: 'How many shifts a week you would like. We aim for this.',
    note: 'what we aim for',
    label: 'preferred shifts per week',
    min: 1,
    max: 14,
    step: 1,
  },
  {
    key: 'maxShifts',
    title: 'Most shifts',
    unit: 'shifts',
    help: 'The most shifts a week you will take. We never go past this without your approval.',
    note: 'never exceeded',
    label: 'maximum shifts per week',
    min: 1,
    max: 14,
    step: 1,
  },
];

const EXPLAINER =
  'When scheduling we will try to hit your preferred number of shifts and not go past the maximum. Leave any of them blank for no preference.';

/** How long a row waits after the last keystroke before saving. */
const AUTOSAVE_DELAY_MS = 800;

/** Same value as far as the column cares: both blank, or the same number. */
const sameValue = (a: string, b: string): boolean =>
  a.trim() === '' || b.trim() === '' ? a.trim() === b.trim() : Number(a) === Number(b);

const sameDraft = (a: PrefsDraft, b: PrefsDraft): boolean =>
  FIELDS.every(({ key }) => sameValue(a[key], b[key]));

type RowStatus = { state: 'saving' } | { state: 'saved' } | { state: 'error'; message: string };

async function readError(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export function ScheduleShiftPrefs({
  staff,
  canManage,
  selfId,
  onSaved,
}: {
  staff: StaffRow[];
  canManage: boolean;
  selfId: string | null;
  onSaved: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, PrefsDraft>>({});
  const [status, setStatus] = useState<Record<string, RowStatus>>({});

  // The save timers and in-flight requests run outside render, so they read
  // the latest drafts and rows through refs rather than a stale closure.
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const staffRef = useRef(staff);
  staffRef.current = staff;
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const inFlight = useRef(new Set<string>());

  // Once the reloaded rows carry a draft's values, the draft has nothing left
  // to say — drop it, so a later change from someone else shows through.
  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const [id, draft] of Object.entries(prev)) {
        const row = staff.find((s) => s.id === id);
        if (
          row &&
          sameDraft(draft, draftFor(row)) &&
          !timers.current[id] &&
          !inFlight.current.has(id)
        ) {
          delete next[id];
        }
      }
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [staff]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of Object.values(pending)) clearTimeout(timer);
    };
  }, []);

  const flush = async (id: string): Promise<void> => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    // One request per row at a time; edits made meanwhile go in the next one.
    if (inFlight.current.has(id)) {
      timers.current[id] = setTimeout(() => void flush(id), AUTOSAVE_DELAY_MS);
      return;
    }
    const draft = draftsRef.current[id];
    const row = staffRef.current.find((s) => s.id === id);
    if (!draft || !row || sameDraft(draft, draftFor(row))) return;

    inFlight.current.add(id);
    setStatus((prev) => ({ ...prev, [id]: { state: 'saving' } }));
    let next: RowStatus;
    try {
      const res = await fetch('/api/admin/staff-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // Lets a save started by leaving the page (blur, then navigate) land.
        keepalive: true,
        // Blank clears each value (all four columns are nullable).
        body: JSON.stringify({
          id,
          ...Object.fromEntries(
            FIELDS.map(({ key }) => [key, draft[key].trim() === '' ? null : Number(draft[key])])
          ),
        }),
      });
      next = res.ok ? { state: 'saved' } : { state: 'error', message: await readError(res) };
      if (res.ok) {
        // The board and the Calendar/Hours tabs all read staff rows from the
        // cached schedule-board payload.
        invalidateJson('/api/admin/schedule-board');
        onSaved();
      }
    } catch {
      next = { state: 'error', message: 'Could not save — check your connection.' };
    }
    inFlight.current.delete(id);
    setStatus((prev) => ({ ...prev, [id]: next }));
  };

  // Managers plan everyone on the roster (yourself included, if you're on
  // it); everyone else sees only their own row.
  const people = canManage
    ? staff.filter((s) => s.active || s.id === selfId)
    : staff.filter((s) => s.id === selfId);
  if (people.length === 0) return null;

  const rowState = (person: StaffRow) => {
    const draft = drafts[person.id] ?? draftFor(person);
    const setDraft = (fields: Partial<PrefsDraft>) => {
      setDrafts((prev) => ({
        ...prev,
        [person.id]: { ...(prev[person.id] ?? draftFor(person)), ...fields },
      }));
      clearTimeout(timers.current[person.id]);
      timers.current[person.id] = setTimeout(() => void flush(person.id), AUTOSAVE_DELAY_MS);
    };
    return { draft, setDraft };
  };

  const input = (
    person: StaffRow,
    field: (typeof FIELDS)[number],
    draft: PrefsDraft,
    setDraft: (fields: Partial<PrefsDraft>) => void,
    id?: string
  ) => (
    <input
      id={id}
      className={`${inputClass} w-20`}
      type="number"
      min={field.min}
      max={field.max}
      step={field.step}
      placeholder="none"
      value={draft[field.key]}
      onChange={(e) => setDraft({ [field.key]: e.target.value })}
      onBlur={() => void flush(person.id)}
      aria-label={`${person.display_name} ${field.label}`}
    />
  );

  const statusLine = (id: string) => {
    const row = status[id];
    if (!row) return null;
    if (row.state === 'error') {
      return <span className="font-mono text-xs text-[var(--pyre-red)]">{row.message}</span>;
    }
    return (
      <span className="font-mono text-xs text-white/40" aria-live="polite">
        {row.state === 'saving' ? 'Saving…' : 'Saved'}
      </span>
    );
  };

  if (!canManage) {
    const [person] = people;
    const { draft, setDraft } = rowState(person);
    return (
      <section className="space-y-3 rounded border border-white/10 bg-white/[0.03] px-4 py-3">
        <div className="flex items-center gap-3">
          <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-white/40">
            Your week
          </h2>
          <span className="ml-auto">{statusLine(person.id)}</span>
        </div>
        <p className="font-mono text-xs text-white/40">{EXPLAINER}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FIELDS.map((field) => (
            <div key={field.key} className="space-y-1.5 rounded border border-white/10 px-3 py-2">
              <label
                htmlFor={`own-pref-${field.key}`}
                className="block font-mono text-xs text-[var(--pyre-creme)]"
              >
                {field.title}
              </label>
              <div className="flex items-center gap-1.5 font-mono text-xs text-white/50">
                {input(person, field, draft, setDraft, `own-pref-${field.key}`)}
                {field.unit}
              </div>
              <p className="text-xs text-white/40">{field.help}</p>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <details className="group rounded border border-white/10 bg-white/[0.03] px-4 py-3">
      <summary className="cursor-pointer list-none font-mono text-xs font-bold uppercase tracking-wide text-white/40 hover:text-white/70">
        <span className="mr-1 inline-block transition-transform group-open:rotate-90">›</span>
        Shift preferences
      </summary>
      <div className="mt-3 space-y-3">
        <p className="font-mono text-xs text-white/40">{EXPLAINER} Changes save automatically.</p>
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left font-mono text-xs uppercase tracking-wide text-white/40">
                <th className="py-2 pr-4 align-bottom">Person</th>
                {FIELDS.map((field) => (
                  <th
                    key={field.key}
                    className="whitespace-nowrap py-2 pr-3 align-bottom font-normal"
                  >
                    <span className="block font-bold">{field.title}</span>
                    <span className="block normal-case tracking-normal text-white/30">
                      {field.note}
                    </span>
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {people.map((person) => {
                const { draft, setDraft } = rowState(person);
                return (
                  <tr key={person.id} className="border-b border-white/5">
                    <td className="whitespace-nowrap py-1.5 pr-4">
                      {person.display_name}
                      {person.id === selfId && (
                        <span className="ml-2 font-mono text-[10px] uppercase text-white/40">
                          you
                        </span>
                      )}
                    </td>
                    {FIELDS.map((field) => (
                      <td key={field.key} className="py-1.5 pr-3">
                        {input(person, field, draft, setDraft)}
                      </td>
                    ))}
                    <td className="min-w-24 py-1.5">{statusLine(person.id)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
