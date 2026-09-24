// Per-person hours for the week on the board, so a manager handing out
// shifts can see who is heavy and who is light without leaving for the Hours
// tab. Scheduled shift hours only (no stipends — those are fixed and never
// change with the board). Live hours and hours in an unaccepted AI draft are
// kept apart, since a draft under review is exactly when this matters.
// Each row also counts the person's shifts against their min / preferred /
// max shifts per week, when any are set.
//
// Desktop: a sticky column to the left of the day list. Phone: a floating
// Hours button opens the same list as a bottom sheet. Clicking a person
// toggles them in the board's people filter, so "why is Sarah at 30h" is one
// tap away from her shifts.

import { assignmentHours, weekStartOf } from '@pyre/schedule-core';
import { useEffect, useMemo, useState } from 'react';
import type { ShiftAssignmentRow, ShiftRow, StaffRow } from '@/lib/db';

export interface WeekHoursRow {
  staff: StaffRow;
  /** Hours on accepted (non-draft) assignments this week. */
  live: number;
  /** Hours on draft assignments still under review. */
  draft: number;
  /** Accepted assignments this week — one assignment is one shift. */
  liveShifts: number;
  /** Draft assignments still under review. */
  draftShifts: number;
}

export interface WeekHoursTotals {
  live: number;
  draft: number;
  /** Active, non-draft shifts in the week. */
  shifts: number;
  /** People with any hours (live or draft). */
  scheduled: number;
}

/**
 * One row per person for the Monday week `weekStart`: everyone on the roster
 * (zero-hour people included — an empty week is the point), plus anyone off
 * the roster who still has hours in it. Heaviest first, then by name.
 */
export function weekHoursRows(
  staff: StaffRow[],
  shifts: Array<ShiftRow & { assignments: ShiftAssignmentRow[] }>,
  weekStart: string
): { rows: WeekHoursRow[]; totals: WeekHoursTotals } {
  const live: Record<string, number> = {};
  const draft: Record<string, number> = {};
  const liveShifts: Record<string, number> = {};
  const draftShifts: Record<string, number> = {};
  let shiftCount = 0;
  for (const shift of shifts) {
    if (shift.status !== 'active' || weekStartOf(shift.shift_date) !== weekStart) continue;
    if (!shift.is_draft) shiftCount += 1;
    for (const a of shift.assignments) {
      const bucket = a.is_draft ? draft : live;
      bucket[a.staff_id] = (bucket[a.staff_id] ?? 0) + assignmentHours(a.starts_at, a.ends_at);
      const counts = a.is_draft ? draftShifts : liveShifts;
      counts[a.staff_id] = (counts[a.staff_id] ?? 0) + 1;
    }
  }
  const rows = staff
    .filter((s) => s.active || live[s.id] || draft[s.id])
    .map((s) => ({
      staff: s,
      live: live[s.id] ?? 0,
      draft: draft[s.id] ?? 0,
      liveShifts: liveShifts[s.id] ?? 0,
      draftShifts: draftShifts[s.id] ?? 0,
    }))
    .sort(
      (a, b) =>
        b.live + b.draft - (a.live + a.draft) ||
        a.staff.display_name.localeCompare(b.staff.display_name)
    );
  const totals: WeekHoursTotals = {
    live: rows.reduce((sum, r) => sum + r.live, 0),
    draft: rows.reduce((sum, r) => sum + r.draft, 0),
    shifts: shiftCount,
    scheduled: rows.filter((r) => r.live + r.draft > 0).length,
  };
  return { rows, totals };
}

const fmt = (hours: number): string => (Number.isInteger(hours) ? String(hours) : hours.toFixed(1));

/**
 * How a person's total reads against their target: over it in red, within
 * an hour of it in sage, otherwise plain; nothing scheduled fades out.
 */
const toneFor = (total: number, target: number | null): string => {
  if (total === 0) return 'text-white/40';
  if (target === null) return 'text-[var(--pyre-creme)]';
  if (total > target) return 'text-[var(--pyre-red)]';
  if (target - total <= 1) return 'text-[var(--pyre-sage)]';
  return 'text-[var(--pyre-creme)]';
};

const barTone = (total: number, target: number | null): string => {
  if (target !== null && total > target) return 'bg-[var(--pyre-red)]';
  if (target !== null && target - total <= 1) return 'bg-[var(--pyre-sage)]';
  return 'bg-[var(--pyre-gold)]';
};

/**
 * The shift count against the person's preferences, e.g. "3 shifts · want 4
 * (2–5)": over the max in red, under the min in gold, on the preferred count
 * in sage. Null when they have no preferences set — managers never receive
 * them (they're redacted like pay), so the line only shows for admins and
 * the person themselves.
 */
export function shiftPrefLine(
  staff: StaffRow,
  shifts: number
): { text: string; tone: string } | null {
  const {
    min_shifts_per_week: min,
    preferred_shifts_per_week: preferred,
    max_shifts_per_week: max,
  } = staff;
  if (min === null && preferred === null && max === null) return null;
  const range =
    min !== null && max !== null
      ? `${min}–${max}`
      : min !== null
        ? `min ${min}`
        : max !== null
          ? `max ${max}`
          : '';
  const parts = [preferred !== null ? `want ${preferred}` : '', range ? `(${range})` : '']
    .filter(Boolean)
    .join(' ');
  const tone =
    max !== null && shifts > max
      ? 'text-[var(--pyre-red)]'
      : min !== null && shifts < min
        ? 'text-[var(--pyre-gold)]'
        : preferred !== null && shifts === preferred
          ? 'text-[var(--pyre-sage)]'
          : 'text-white/50';
  return { text: `${shifts} shift${shifts === 1 ? '' : 's'} · ${parts}`, tone };
}

export function WeekHoursList({
  rows,
  totals,
  selected,
  onToggle,
}: {
  rows: WeekHoursRow[];
  totals: WeekHoursTotals;
  /** Staff ids in the board's people filter — their rows are marked. */
  selected: ReadonlySet<string>;
  onToggle: (staffId: string) => void;
}) {
  // Bars are relative to the person's target when they have one, otherwise
  // to the heaviest week on the list, so the list still reads at a glance
  // for managers (who never receive targets — they are pay data).
  const heaviest = Math.max(1, ...rows.map((r) => r.live + r.draft));
  const anyTarget = rows.some((r) => r.staff.target_hours_per_week !== null);
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {rows.map(({ staff, live, draft, liveShifts, draftShifts }) => {
          const total = live + draft;
          const shiftPrefs = shiftPrefLine(staff, liveShifts + draftShifts);
          const target = staff.target_hours_per_week;
          const active = selected.has(staff.id);
          const width = Math.min(100, (total / (target ?? heaviest)) * 100);
          const over = target !== null && total > target ? total - target : 0;
          return (
            <li key={staff.id}>
              <button
                type="button"
                aria-pressed={active}
                title={
                  over > 0
                    ? `${fmt(over)}h over target — click to show only their shifts`
                    : 'Click to show only their shifts'
                }
                onClick={() => onToggle(staff.id)}
                className={`block w-full rounded border px-2 py-1.5 text-left transition-colors ${
                  active
                    ? 'border-[var(--pyre-gold)] bg-[var(--pyre-gold)]/10'
                    : 'border-transparent hover:border-white/15 hover:bg-white/5'
                } ${!staff.active ? 'opacity-60' : ''}`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span
                    className={`truncate text-sm ${total === 0 ? 'text-white/50' : 'text-white/80'}`}
                  >
                    {staff.display_name}
                    {!staff.active && (
                      <span className="ml-1 font-mono text-[10px] text-white/40">off roster</span>
                    )}
                  </span>
                  <span
                    className={`shrink-0 font-mono text-xs tabular-nums ${toneFor(total, target)}`}
                  >
                    {fmt(live)}
                    {draft > 0 && (
                      <>
                        {' '}
                        <span className="rounded bg-[var(--pyre-blue)]/40 px-1 text-[var(--pyre-creme)]">
                          +{fmt(draft)}
                        </span>
                      </>
                    )}
                    {target !== null ? ` / ${fmt(target)}h` : 'h'}
                  </span>
                </span>
                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/10">
                  <span
                    className={`block h-full rounded-full ${barTone(total, target)}`}
                    style={{ width: `${width}%` }}
                  />
                </span>
                {shiftPrefs && (
                  <span
                    className={`mt-1 block font-mono text-[10px] tabular-nums ${shiftPrefs.tone}`}
                  >
                    {shiftPrefs.text}
                  </span>
                )}
              </button>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="font-mono text-xs text-white/30">Nobody on the roster</li>
        )}
      </ul>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-white/10 pt-3 font-mono text-xs">
        <dt className="text-white/40">Team hours</dt>
        <dd className="text-right tabular-nums text-[var(--pyre-creme)]">
          {fmt(totals.live)}
          {totals.draft > 0 && (
            <>
              {' '}
              <span className="rounded bg-[var(--pyre-blue)]/40 px-1 text-[var(--pyre-creme)]">
                +{fmt(totals.draft)}
              </span>
            </>
          )}
          h
        </dd>
        <dt className="text-white/40">Shifts</dt>
        <dd className="text-right tabular-nums text-[var(--pyre-creme)]">{totals.shifts}</dd>
        <dt className="text-white/40">Scheduled</dt>
        <dd className="text-right tabular-nums text-[var(--pyre-creme)]">
          {totals.scheduled} of {rows.length}
        </dd>
      </dl>
      {(totals.draft > 0 || anyTarget) && (
        <p className="font-mono text-[10px] leading-relaxed text-white/40">
          {totals.draft > 0 && (
            <>
              <span className="rounded bg-[var(--pyre-blue)]/40 px-1 text-[var(--pyre-creme)]">
                +n
              </span>{' '}
              is hours in the AI draft under review.{' '}
            </>
          )}
          {anyTarget && 'Bars run to each person’s weekly target.'}
        </p>
      )}
    </div>
  );
}

const panelTitleClass = 'font-mono text-xs font-bold uppercase tracking-wide text-white/40';

/**
 * The desktop column: sticky under the admin header beside the day list.
 * Hidden below lg, where the sheet takes over.
 */
export function WeekHoursSidebar({
  weekLabel,
  ...list
}: {
  weekLabel: string;
  rows: WeekHoursRow[];
  totals: WeekHoursTotals;
  selected: ReadonlySet<string>;
  onToggle: (staffId: string) => void;
}) {
  return (
    <aside
      aria-label="Hours this week"
      className="hidden lg:block lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto rounded-lg border border-white/10 bg-white/[0.03] p-3"
    >
      <p className={panelTitleClass}>Hours this week</p>
      <p className="mb-3 font-mono text-[10px] text-white/30">{weekLabel}</p>
      <WeekHoursList {...list} />
    </aside>
  );
}

/**
 * The phone version: a floating Hours button (with the team total) that
 * opens the list as a bottom sheet. Hidden at lg and up.
 */
export function WeekHoursSheet({
  weekLabel,
  ...list
}: {
  weekLabel: string;
  rows: WeekHoursRow[];
  totals: WeekHoursTotals;
  selected: ReadonlySet<string>;
  onToggle: (staffId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    // The sheet scrolls inside itself; the page behind it holds still.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [open]);

  const summary = useMemo(() => `${fmt(list.totals.live)}h`, [list.totals.live]);

  return (
    <div className="lg:hidden">
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="fixed right-4 bottom-4 z-30 flex items-center gap-2 rounded-full border border-[var(--pyre-gold)]/50 bg-[var(--pyre-black)] px-4 py-2 font-mono text-xs uppercase tracking-wide text-[var(--pyre-gold)] shadow-lg hover:border-[var(--pyre-gold)]"
        >
          Hours
          <span className="tabular-nums text-[var(--pyre-creme)]">{summary}</span>
        </button>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-black/70"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="week-hours-title"
            className="relative flex max-h-[80dvh] w-full flex-col rounded-t-lg border border-white/15 bg-[var(--pyre-black)] shadow-xl"
          >
            <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
              <div>
                <h2 id="week-hours-title" className={panelTitleClass}>
                  Hours this week
                </h2>
                <p className="font-mono text-[10px] text-white/30">{weekLabel}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white"
              >
                Close
              </button>
            </div>
            <div className="overflow-y-auto px-4 pb-6">
              <WeekHoursList {...list} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
