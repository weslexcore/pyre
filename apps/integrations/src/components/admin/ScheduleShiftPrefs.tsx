// Scheduling preferences on the Hours tab: each person's h/wk target and
// shifts-per-week range (min / preferred / max), which the AI drafter plans
// around. Managers get a table of everyone on the roster; everyone else gets
// a card for their own row. Rows come from the schedule-board payload the
// Hours tab already loads; saves go through /api/admin/staff-preferences.

import { useState } from 'react';
import { invalidateJson } from '@/lib/client/cachedJson';
import type { StaffRow } from '@/lib/db';

const inputClass =
  'px-2 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30';

const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

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
  {
    key: 'targetHours',
    title: 'Weekly hours',
    unit: 'hrs',
    help: 'How many hours a week you would like to work.',
    note: 'hours they want',
    label: 'target hours per week',
    min: 0,
    max: 168,
    step: 0.5,
  },
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
    help: 'The most shifts a week you will take. We never go past this.',
    note: 'never exceeded',
    label: 'maximum shifts per week',
    min: 1,
    max: 14,
    step: 1,
  },
];

const EXPLAINER =
  'When scheduling we will try to hit your preferred number of shifts and not go past the maximum. Leave any of them blank for no preference.';

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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Managers plan everyone on the roster (yourself included, if you're on
  // it); everyone else sees only their own row.
  const people = canManage
    ? staff.filter((s) => s.active || s.id === selfId)
    : staff.filter((s) => s.id === selfId);
  if (people.length === 0) return null;

  const save = async (person: StaffRow, draft: PrefsDraft) => {
    setBusyId(person.id);
    setError(null);
    const res = await fetch('/api/admin/staff-preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      // Blank clears each value (all four columns are nullable).
      body: JSON.stringify({
        id: person.id,
        ...Object.fromEntries(
          FIELDS.map(({ key }) => [key, draft[key].trim() === '' ? null : Number(draft[key])])
        ),
      }),
    });
    if (!res.ok) {
      setError(await readError(res));
    } else {
      const { [person.id]: _saved, ...rest } = drafts;
      setDrafts(rest);
      // The board and the Calendar/Hours tabs all read staff rows from the
      // cached schedule-board payload.
      invalidateJson('/api/admin/schedule-board');
      onSaved();
    }
    setBusyId(null);
  };

  const rowState = (person: StaffRow) => {
    const saved = draftFor(person);
    const draft = drafts[person.id] ?? saved;
    const dirty = FIELDS.some(({ key }) => draft[key].trim() !== saved[key]);
    const setDraft = (fields: Partial<PrefsDraft>) =>
      setDrafts({ ...drafts, [person.id]: { ...draft, ...fields } });
    return { draft, dirty, setDraft };
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
      disabled={busyId === person.id}
      onChange={(e) => setDraft({ [field.key]: e.target.value })}
      aria-label={`${person.display_name} ${field.label}`}
    />
  );

  const errorBox = error && (
    <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-red)]">
      {error}
    </p>
  );

  if (!canManage) {
    const [person] = people;
    const { draft, dirty, setDraft } = rowState(person);
    return (
      <section className="space-y-3 rounded border border-white/10 bg-white/[0.03] px-4 py-3">
        <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-white/40">
          Your week
        </h2>
        <p className="font-mono text-xs text-white/40">{EXPLAINER}</p>
        {errorBox}
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
        {dirty && (
          <button
            type="button"
            className={buttonClass}
            disabled={busyId !== null}
            onClick={() => void save(person, draft)}
          >
            Save
          </button>
        )}
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
        <p className="font-mono text-xs text-white/40">{EXPLAINER}</p>
        {errorBox}
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
                const { draft, dirty, setDraft } = rowState(person);
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
                    <td className="py-1.5">
                      {dirty && (
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={busyId !== null}
                          onClick={() => void save(person, draft)}
                        >
                          Save
                        </button>
                      )}
                    </td>
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
