// The weekly scheduling board: shifts per day with red/gold/green coverage
// status (the sheet's row colors), inline shift create/edit, and an
// assignment picker that shows each person's availability — computed locally
// via lib/schedule/availability from the same time-off data the API returns —
// plus their hours already scheduled that week. Days the viewer works are
// picked out in gold, with their own name first in each shift's name list.

import {
  ASSIGNMENT_ROLE_LABELS,
  ASSIGNMENT_ROLES,
  type AssignmentRole,
  type Availability,
  addDays,
  assignmentHours,
  availabilityFor,
  DOW_LABELS,
  firstTentativeDate,
  formatShiftNotes,
  minutesToTime,
  missingShiftLead,
  SHIFT_LABEL_SUGGESTIONS,
  timeToMinutes,
  weekStartOf,
} from '@pyre/schedule-core';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ScheduleProposalRow,
  ShiftAssignmentRow,
  ShiftRequestRow,
  ShiftRow,
  StaffRow,
  SubRequestRow,
  TimeOffRow,
} from '@/lib/db';
import { readMyShiftsPref, writeMyShiftsPref } from './myShiftsPref';

interface BoardShift extends ShiftRow {
  assignments: ShiftAssignmentRow[];
}

interface BoardSettings {
  shiftRequestsEnabled: boolean;
  subRequestsEnabled: boolean;
}

const DEFAULT_SETTINGS: BoardSettings = { shiftRequestsEnabled: true, subRequestsEnabled: true };

interface BoardData {
  staff: StaffRow[];
  shifts: BoardShift[];
  timeOff: TimeOffRow[];
  proposals?: ScheduleProposalRow[];
  /** Manage side (schedule:manage / admin) — false renders a read-only board. */
  canManage?: boolean;
  /** Admins additionally see the employee-action toggles. */
  isAdmin?: boolean;
  selfStaffId?: string | null;
  /** Pending requests (all of them on the manage side, own only otherwise). */
  shiftRequests?: ShiftRequestRow[];
  /** Open sub requests — visible to everyone so any teammate can take one. */
  subRequests?: SubRequestRow[];
  settings?: BoardSettings;
}

const SYNC_FLAG_LABELS: Record<NonNullable<ShiftRow['sync_flag']>, string> = {
  sessions_cancelled: 'Momence sessions cancelled',
  times_changed: 'Momence times changed',
};

const inputClass =
  'w-full px-3 py-2 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30';

const pillClass = (active: boolean) =>
  `px-2.5 py-1.5 rounded text-xs font-mono uppercase tracking-wide border transition-colors ${
    active
      ? 'border-[var(--pyre-red)] bg-[var(--pyre-red)]/15 text-[var(--pyre-creme)]'
      : 'border-white/10 bg-white/5 text-white/50 hover:border-white/30 hover:text-white'
  }`;

const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

const todayLocal = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const hhmm = (t: string) => t.slice(0, 5);

const formatTime = (t: string): string => {
  const min = timeToMinutes(t);
  const h = Math.floor(min / 60);
  const m = min % 60;
  const suffix = h < 12 ? 'a' : 'p';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
};

const formatDay = (date: string): string => {
  const [, m, d] = date.split('-');
  return `${DOW_LABELS[new Date(`${date}T00:00:00`).getDay()]} ${Number(m)}/${Number(d)}`;
};

// The board's three ways of slicing the same data: one week (the default),
// a whole calendar month as the same day list, or every under-staffed shift
// coming up (manage side only).
type BoardView = 'week' | 'month' | 'uncovered';

/** How far ahead the uncovered view looks. Momence sync only creates shifts
 * ~3 weeks out, but manual and drafted shifts can sit further ahead. */
const UNCOVERED_HORIZON_DAYS = 182;

const monthStartOf = (date: string): string => `${date.slice(0, 7)}-01`;

const addMonths = (monthStart: string, n: number): string => {
  const [y, m] = monthStart.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
};

const daysInMonth = (monthStart: string): number => {
  const [y, m] = monthStart.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};

const monthLabel = (monthStart: string): string =>
  new Date(`${monthStart}T00:00:00`).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  });

/**
 * The Setup role's span from the shift-window start. Windows are derived with
 * a 90min lead before the first session (leadMin in schedule-core), so window
 * start + 2h = 30min after sessions begin — the requested setup handoff point.
 */
const SETUP_DURATION_MIN = 120;

/** Active, live (non-draft) shift still short of staff_needed — draft
 * assignments don't count as coverage until accepted. */
const isUncovered = (shift: BoardShift): boolean =>
  shift.status === 'active' &&
  !shift.is_draft &&
  shift.staff_needed > 0 &&
  shift.assignments.filter((a) => !a.is_draft).length < shift.staff_needed;

type CoverageTone = 'empty' | 'under' | 'covered' | 'cancelled';

const coverageTone = (shift: BoardShift): CoverageTone => {
  if (shift.status === 'cancelled') return 'cancelled';
  if (shift.assignments.length === 0 && shift.staff_needed > 0) return 'empty';
  if (shift.assignments.length < shift.staff_needed) return 'under';
  return 'covered';
};

const toneBorder: Record<CoverageTone, string> = {
  empty: 'border-[var(--pyre-red)]/60',
  under: 'border-[var(--pyre-gold)]/60',
  covered: 'border-[var(--pyre-sage)]/50',
  cancelled: 'border-white/10 opacity-50',
};

const toneChip: Record<CoverageTone, string> = {
  empty: 'bg-[var(--pyre-red)]/20 text-[var(--pyre-red)]',
  under: 'bg-[var(--pyre-gold)]/20 text-[var(--pyre-gold)]',
  covered: 'bg-[var(--pyre-sage)]/20 text-[var(--pyre-sage)]',
  cancelled: 'bg-white/10 text-white/50',
};

/**
 * The viewer's own assignment sorts to the front of a shift's name list so
 * they find themselves without reading the whole roster. Sort is stable, so
 * everyone else keeps their existing order.
 */
const selfFirst = <T extends { staff_id: string }>(
  rows: readonly T[],
  selfId: string | null
): T[] =>
  selfId
    ? [...rows].sort((a, b) => Number(b.staff_id === selfId) - Number(a.staff_id === selfId))
    : [...rows];

const selfNameClass = 'font-semibold text-[var(--pyre-gold)]';

const availabilityBadge = (availability: Availability): { label: string; className: string } => {
  switch (availability.status) {
    case 'free':
      return { label: 'free', className: 'text-[var(--pyre-sage)]' };
    case 'partial':
      return { label: 'partial', className: 'text-[var(--pyre-gold)]' };
    case 'busy':
      return { label: 'unavailable', className: 'text-[var(--pyre-red)]' };
  }
};

interface ShiftFormState {
  label: string;
  startsAt: string;
  endsAt: string;
  staffNeeded: string;
  notes: string;
}

const emptyShiftForm: ShiftFormState = {
  label: 'Evening',
  startsAt: '14:30',
  endsAt: '20:30',
  staffNeeded: '2',
  notes: '',
};

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ error?: string }> {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.ok) return {};
  try {
    return { error: ((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}` };
  } catch {
    return { error: `HTTP ${res.status}` };
  }
}

export function ScheduleBoard() {
  const [view, setView] = useState<BoardView>('week');
  const [weekStart, setWeekStart] = useState(() => weekStartOf(todayLocal()));
  const [monthStart, setMonthStart] = useState(() => monthStartOf(todayLocal()));
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Read-only view: every shift starts expanded so assigned hours are visible
  // without clicking through; this tracks the ones the viewer closed.
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // Shift form: 'new:<date>' or 'edit:<shiftId>'
  const [formTarget, setFormTarget] = useState<string | null>(null);
  const [form, setForm] = useState<ShiftFormState>(emptyShiftForm);
  const [editingAssignment, setEditingAssignment] = useState<string | null>(null);
  // Agent drafting: set while waiting for a new proposal to appear.
  const [drafting, setDrafting] = useState(false);
  const draftPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // "My shifts": filter the week/month lists to shifts the viewer is on.
  const [mineOnly, setMineOnly] = useState(readMyShiftsPref);
  // Admin-only panel with the employee-action toggles.
  const [showSettings, setShowSettings] = useState(false);

  // What the API is asked for. The uncovered view starts its range on the
  // current week's Monday (not today) so this week's hours totals in the
  // assignment picker stay complete; days before today are filtered out of
  // the list below, which also keeps it to live coverage only (no drafts).
  // Week and month views fetch drafts for review.
  const range = useMemo(() => {
    if (view === 'month')
      return { start: monthStart, end: addDays(monthStart, daysInMonth(monthStart) - 1) };
    if (view === 'uncovered') {
      const start = weekStartOf(todayLocal());
      return { start, end: addDays(start, UNCOVERED_HORIZON_DAYS) };
    }
    return { start: weekStart, end: addDays(weekStart, 6) };
  }, [view, weekStart, monthStart]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/schedule-board?start=${range.start}&end=${range.end}${
          view === 'week' || view === 'month' ? '&includeDrafts=1' : ''
        }`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as BoardData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [range, view]);

  useEffect(() => {
    void load();
  }, [load]);

  const canManage = data?.canManage ?? false;
  const isAdmin = data?.isAdmin ?? false;
  const selfId = data?.selfStaffId ?? null;
  const settings = data?.settings ?? DEFAULT_SETTINGS;

  const toggleMineOnly = () => {
    setMineOnly((v) => {
      writeMyShiftsPref(!v);
      return !v;
    });
  };

  // The commitment boundary (schedule-core): the schedule locks whole
  // Mon–Sun weeks covering at least the next two weeks, so this is always a
  // Monday. Dates from here on get the "≈ tentative" treatment, and a banner
  // explains it whenever the visible range reaches past the boundary.
  const firstTentative = firstTentativeDate(todayLocal());

  // Uncovered shifts from today forward (the fetched range reaches back to
  // Monday only for the hours math — past gaps aren't actionable).
  const uncoveredShifts = useMemo(() => {
    if (view !== 'uncovered') return [];
    const today = todayLocal();
    return (data?.shifts ?? []).filter((s) => s.shift_date >= today && isUncovered(s));
  }, [view, data]);

  const days = useMemo(() => {
    if (view === 'month') {
      return Array.from({ length: daysInMonth(monthStart) }, (_, i) => addDays(monthStart, i));
    }
    if (view === 'uncovered') {
      return [...new Set(uncoveredShifts.map((s) => s.shift_date))].sort();
    }
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [view, weekStart, monthStart, uncoveredShifts]);

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, BoardShift[]>();
    for (const shift of data?.shifts ?? []) {
      const list = map.get(shift.shift_date) ?? [];
      list.push(shift);
      map.set(shift.shift_date, list);
    }
    return map;
  }, [data]);

  const staffById = useMemo(() => new Map((data?.staff ?? []).map((s) => [s.id, s])), [data]);

  const requestsByShift = useMemo(() => {
    const map = new Map<string, ShiftRequestRow[]>();
    for (const request of data?.shiftRequests ?? []) {
      const list = map.get(request.shift_id) ?? [];
      list.push(request);
      map.set(request.shift_id, list);
    }
    return map;
  }, [data]);

  const subsByShift = useMemo(() => {
    const map = new Map<string, SubRequestRow[]>();
    for (const sub of data?.subRequests ?? []) {
      const list = map.get(sub.shift_id) ?? [];
      list.push(sub);
      map.set(sub.shift_id, list);
    }
    return map;
  }, [data]);

  // Days the viewer is on the schedule — those get the gold treatment.
  const selfDates = useMemo(() => {
    const dates = new Set<string>();
    if (!selfId) return dates;
    for (const shift of data?.shifts ?? []) {
      if (shift.status === 'cancelled') continue;
      if (shift.assignments.some((a) => a.staff_id === selfId)) dates.add(shift.shift_date);
    }
    return dates;
  }, [data, selfId]);

  // Hours already scheduled per staff id, bucketed by Monday week start —
  // the month and uncovered views span several weeks, and the assignment
  // picker's "h wk" figure must be the hours of the shift's own week.
  const weekHoursByWeek = useMemo(() => {
    const byWeek: Record<string, Record<string, number>> = {};
    for (const shift of data?.shifts ?? []) {
      if (shift.status !== 'active') continue;
      const week = weekStartOf(shift.shift_date);
      byWeek[week] ??= {};
      const bucket = byWeek[week];
      for (const a of shift.assignments) {
        bucket[a.staff_id] = (bucket[a.staff_id] ?? 0) + assignmentHours(a.starts_at, a.ends_at);
      }
    }
    return byWeek;
  }, [data]);

  const run = useCallback(
    async (action: () => Promise<{ error?: string }>) => {
      setBusy(true);
      setError(null);
      const { error: actionError } = await action();
      if (actionError) setError(actionError);
      await load();
      setBusy(false);
    },
    [load]
  );

  const openNewShift = (date: string) => {
    setForm(emptyShiftForm);
    setFormTarget(`new:${date}`);
  };

  const openEditShift = (shift: BoardShift) => {
    setForm({
      label: shift.label,
      startsAt: hhmm(shift.starts_at),
      endsAt: hhmm(shift.ends_at),
      staffNeeded: String(shift.staff_needed),
      notes: shift.notes ?? '',
    });
    setFormTarget(`edit:${shift.id}`);
  };

  // Draft proposals to show banners for: the visible week's in week view,
  // every fetched one (sorted by week) in month view.
  const visibleProposals = useMemo(() => {
    const drafts = (data?.proposals ?? []).filter((p) => p.status === 'draft');
    if (view === 'week') return drafts.filter((p) => p.week_start === weekStart);
    if (view === 'month')
      return [...drafts].sort((a, b) => a.week_start.localeCompare(b.week_start));
    return [];
  }, [data, view, weekStart]);

  // Weeks the Draft button targets: the visible week, or in month view every
  // week that still has an uncovered shift today or later.
  const draftTargetWeeks = useMemo(() => {
    if (view === 'week') return [weekStart];
    if (view !== 'month') return [];
    const today = todayLocal();
    const weeks = new Set<string>();
    for (const s of data?.shifts ?? []) {
      if (s.shift_date >= today && isUncovered(s)) weeks.add(weekStartOf(s.shift_date));
    }
    return [...weeks].sort();
  }, [view, weekStart, data]);

  const syncMomence = async () => {
    await run(async () => {
      const res = await fetch('/api/admin/sync-shifts', { method: 'POST' });
      if (!res.ok) {
        try {
          return {
            error: ((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`,
          };
        } catch {
          return { error: `HTTP ${res.status}` };
        }
      }
      return {};
    });
  };

  const draftSchedule = async () => {
    const targetWeeks = draftTargetWeeks;
    if (targetWeeks.length === 0) return;
    setDrafting(true);
    setError(null);
    const res = await fetch('/api/admin/schedule-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekStarts: targetWeeks }),
    });
    if (!res.ok) {
      try {
        setError(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
      } catch {
        setError(`HTTP ${res.status}`);
      }
      setDrafting(false);
      return;
    }
    // Poll until every requested week has a new draft proposal (the agent
    // sessions run async and in parallel); ~3min budget.
    const beforeIds = new Set((data?.proposals ?? []).map((p) => p.id));
    const startedAt = Date.now();
    const pollUrl = `/api/admin/schedule-board?start=${range.start}&end=${range.end}&includeDrafts=1`;
    if (draftPollRef.current) clearInterval(draftPollRef.current);
    draftPollRef.current = setInterval(async () => {
      const boardRes = await fetch(pollUrl);
      if (boardRes.ok) {
        const board = (await boardRes.json()) as BoardData;
        const freshWeeks = new Set(
          (board.proposals ?? []).filter((p) => !beforeIds.has(p.id)).map((p) => p.week_start)
        );
        if (targetWeeks.every((w) => freshWeeks.has(w))) {
          if (draftPollRef.current) clearInterval(draftPollRef.current);
          draftPollRef.current = null;
          setData(board);
          setDrafting(false);
          return;
        }
      }
      if (Date.now() - startedAt > 180_000) {
        if (draftPollRef.current) clearInterval(draftPollRef.current);
        draftPollRef.current = null;
        setDrafting(false);
        setError(
          'The agent is taking longer than expected — refresh in a minute or check the agent logs.'
        );
      }
    }, 5000);
  };

  useEffect(
    () => () => {
      if (draftPollRef.current) clearInterval(draftPollRef.current);
    },
    []
  );

  const proposalAction = (body: Record<string, unknown>) =>
    run(() => api('POST', '/api/admin/schedule-proposals', body));

  const submitShiftForm = async () => {
    if (!formTarget) return;
    const staffNeeded = Number.parseInt(form.staffNeeded, 10);
    const payload = {
      label: form.label.trim(),
      startsAt: form.startsAt,
      endsAt: form.endsAt,
      staffNeeded: Number.isNaN(staffNeeded) ? 2 : staffNeeded,
      notes: form.notes.trim() || null,
    };
    const [mode, target] = formTarget.split(':');
    await run(() =>
      mode === 'new'
        ? api('POST', '/api/admin/shifts', { ...payload, shiftDate: target })
        : api('PATCH', '/api/admin/shifts', { ...payload, id: target })
    );
    setFormTarget(null);
  };

  if (loading && !data) {
    return <p className="font-mono text-sm text-white/40">Loading schedule…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex gap-1.5">
          <button
            type="button"
            className={pillClass(view === 'week')}
            onClick={() => setView('week')}
          >
            Week
          </button>
          <button
            type="button"
            className={pillClass(view === 'month')}
            onClick={() => setView('month')}
          >
            Month
          </button>
          {canManage && (
            <button
              type="button"
              className={pillClass(view === 'uncovered')}
              onClick={() => setView('uncovered')}
            >
              Uncovered
            </button>
          )}
          {selfId && view !== 'uncovered' && (
            <button
              type="button"
              className={`px-2.5 py-1.5 rounded text-xs font-mono uppercase tracking-wide border transition-colors ${
                mineOnly
                  ? 'border-[var(--pyre-gold)] bg-[var(--pyre-gold)]/15 text-[var(--pyre-gold)]'
                  : 'border-white/10 bg-white/5 text-white/50 hover:border-white/30 hover:text-white'
              }`}
              title="Only show shifts you're assigned to"
              onClick={toggleMineOnly}
            >
              My shifts
            </button>
          )}
        </span>

        {view === 'week' && (
          <>
            <button
              type="button"
              className={buttonClass}
              onClick={() => setWeekStart(addDays(weekStart, -7))}
            >
              ‹ Prev
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => setWeekStart(weekStartOf(todayLocal()))}
            >
              This week
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => setWeekStart(addDays(weekStart, 7))}
            >
              Next ›
            </button>
            <span className="font-mono text-xl font-bold text-white/80">
              {formatDay(weekStart)} – {formatDay(addDays(weekStart, 6))}
            </span>
          </>
        )}

        {view === 'month' && (
          <>
            <button
              type="button"
              className={buttonClass}
              onClick={() => setMonthStart(addMonths(monthStart, -1))}
            >
              ‹ Prev
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => setMonthStart(monthStartOf(todayLocal()))}
            >
              This month
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => setMonthStart(addMonths(monthStart, 1))}
            >
              Next ›
            </button>
            <span className="font-mono text-xl font-bold text-white/80">
              {monthLabel(monthStart)}
            </span>
          </>
        )}

        {view === 'uncovered' && (
          <span className="font-mono text-xl font-bold text-white/80">
            {uncoveredShifts.length} uncovered through {range.end}
          </span>
        )}

        {canManage && (
          <span className="ml-auto flex gap-2">
            {isAdmin && (
              <button
                type="button"
                className={buttonClass}
                title="Employee action settings"
                onClick={() => setShowSettings(!showSettings)}
              >
                ⚙ Settings
              </button>
            )}
            <button
              type="button"
              className={buttonClass}
              onClick={() => void syncMomence()}
              disabled={busy || drafting}
            >
              Sync Momence
            </button>
            {(view === 'week' || view === 'month') && (
              <button
                type="button"
                className={`${buttonClass} border-[var(--pyre-red)]/50 text-[var(--pyre-creme)]`}
                onClick={() => void draftSchedule()}
                disabled={busy || drafting || draftTargetWeeks.length === 0}
                title={
                  view === 'month'
                    ? 'Drafts every week this month that still has uncovered shifts'
                    : undefined
                }
              >
                {drafting
                  ? 'Drafting…'
                  : view === 'month'
                    ? `✦ Draft uncovered (${draftTargetWeeks.length} wk)`
                    : '✦ Draft schedule'}
              </button>
            )}
          </span>
        )}
        {busy && <span className="font-mono text-xs text-white/40">Saving…</span>}
        {!busy && loading && data && (
          <span className="font-mono text-xs text-white/40">Loading…</span>
        )}
      </div>

      {error && (
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-red)]">
          {error}
        </p>
      )}

      {range.end >= firstTentative && (
        <p className="rounded border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-white/60">
          Set in stone through{' '}
          <span className="font-bold text-[var(--pyre-creme)]">
            {formatDay(addDays(firstTentative, -1))}
          </span>{' '}
          · weeks after that are <span className="text-white/80">≈ tentative</span> — a working
          plan to keep requesting shifts and logging time off into, but times and assignments can
          still change until the week locks (whole weeks, always at least two weeks ahead).
        </p>
      )}

      {drafting && (
        <p className="rounded border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-white/60">
          Syncing Momence and drafting{' '}
          {draftTargetWeeks.length > 1 ? `${draftTargetWeeks.length} weeks` : 'the week'} —
          proposals will appear here (usually under a minute)…
        </p>
      )}

      {isAdmin && showSettings && (
        <section className="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <p className="font-mono text-xs font-bold uppercase tracking-wide text-white/40">
            Employee actions
          </p>
          <label className="flex items-center gap-2 font-mono text-xs text-white/70">
            <input
              type="checkbox"
              checked={settings.shiftRequestsEnabled}
              disabled={busy}
              onChange={(e) =>
                void run(() =>
                  api('POST', '/api/admin/schedule-settings', {
                    key: 'shift_requests',
                    enabled: e.target.checked,
                  })
                )
              }
            />
            Employees can request open shifts (a manager approves before they're assigned)
          </label>
          <label className="flex items-center gap-2 font-mono text-xs text-white/70">
            <input
              type="checkbox"
              checked={settings.subRequestsEnabled}
              disabled={busy}
              onChange={(e) =>
                void run(() =>
                  api('POST', '/api/admin/schedule-settings', {
                    key: 'sub_requests',
                    enabled: e.target.checked,
                  })
                )
              }
            />
            Employees can request a sub (logs time off, emails the admins, and emails everyone
            available a one-click link to take the shift)
          </label>
        </section>
      )}

      {visibleProposals.map((p) => (
        <ProposalBanner key={p.id} proposal={p} busy={busy} onAction={proposalAction} />
      ))}

      {view === 'uncovered' && days.length === 0 && !loading && (
        <p className="rounded border border-[var(--pyre-sage)]/40 bg-[var(--pyre-sage)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-sage)]">
          Every shift through {range.end} is fully staffed.
        </p>
      )}

      <div className="space-y-4">
        {days.map((date) => {
          const allShifts = shiftsByDate.get(date) ?? [];
          let shifts = view === 'uncovered' ? allShifts.filter(isUncovered) : allShifts;
          if (mineOnly && view !== 'uncovered' && selfId) {
            shifts = shifts.filter((s) => s.assignments.some((a) => a.staff_id === selfId));
          }
          // With the filter on, skip day sections the viewer isn't part of —
          // a filtered month would otherwise be a wall of "No shifts".
          if (
            mineOnly &&
            view !== 'uncovered' &&
            shifts.length === 0 &&
            formTarget !== `new:${date}`
          ) {
            return null;
          }
          const selfWorks = selfDates.has(date);
          return (
            <section
              key={date}
              className={`rounded-lg border p-3 ${
                selfWorks
                  ? 'border-[var(--pyre-gold)]/60 bg-[var(--pyre-gold)]/[0.06]'
                  : 'border-white/10 bg-white/[0.03]'
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2
                  className={`flex flex-wrap items-center gap-2 font-mono text-sm font-bold uppercase tracking-wide ${
                    selfWorks ? 'text-[var(--pyre-gold)]' : 'text-white/70'
                  }`}
                >
                  {formatDay(date)}
                  {selfWorks && (
                    <span className="rounded bg-[var(--pyre-gold)]/20 px-2 py-0.5 text-[10px] tracking-wide text-[var(--pyre-gold)]">
                      you're on
                    </span>
                  )}
                  {date >= firstTentative && (
                    <span
                      className="rounded bg-white/10 px-2 py-0.5 text-[10px] tracking-wide text-white/50"
                      title="This week hasn't locked yet — its schedule can still change"
                    >
                      ≈ tentative
                    </span>
                  )}
                </h2>
                {canManage && view !== 'uncovered' && (
                  <button type="button" className={buttonClass} onClick={() => openNewShift(date)}>
                    + Shift
                  </button>
                )}
              </div>

              {formTarget === `new:${date}` && (
                <ShiftForm
                  form={form}
                  setForm={setForm}
                  onSubmit={submitShiftForm}
                  onCancel={() => setFormTarget(null)}
                  busy={busy}
                />
              )}

              {shifts.length === 0 && formTarget !== `new:${date}` && (
                <p className="font-mono text-xs text-white/30">No shifts</p>
              )}

              <div className="space-y-2">
                {shifts.map((shift) => {
                  const tone = coverageTone(shift);
                  const notes = formatShiftNotes(shift);
                  const requests = requestsByShift.get(shift.id) ?? [];
                  const subs = subsByShift.get(shift.id) ?? [];
                  const noLead =
                    shift.status === 'active' && missingShiftLead(shift.assignments, staffById);
                  const expanded = canManage
                    ? expandedId === shift.id
                    : !collapsedIds.has(shift.id);
                  const toggleExpanded = () => {
                    if (canManage) {
                      setExpandedId(expanded ? null : shift.id);
                    } else {
                      const next = new Set(collapsedIds);
                      if (expanded) next.add(shift.id);
                      else next.delete(shift.id);
                      setCollapsedIds(next);
                    }
                  };
                  return (
                    <div
                      key={shift.id}
                      className={`rounded border bg-white/[0.03] ${toneBorder[tone]} ${shift.is_draft ? 'border-dashed' : ''}`}
                    >
                      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                        <button
                          type="button"
                          className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-left"
                          onClick={toggleExpanded}
                        >
                          <span className="font-semibold">{shift.label}</span>
                          <span className="font-mono text-sm text-white/60">
                            {formatTime(shift.starts_at)}–{formatTime(shift.ends_at)}
                          </span>
                          <span
                            className={`rounded px-2 py-0.5 font-mono text-xs ${toneChip[tone]}`}
                          >
                            {shift.status === 'cancelled'
                              ? 'cancelled'
                              : `${shift.assignments.length}/${shift.staff_needed}`}
                          </span>
                          {shift.is_draft && (
                            <span className="rounded bg-[var(--pyre-blue)]/25 px-2 py-0.5 font-mono text-xs text-[var(--pyre-creme)]">
                              ✦ AI draft
                            </span>
                          )}
                          {shift.sync_flag && (
                            <span className="rounded bg-[var(--pyre-gold)]/20 px-2 py-0.5 font-mono text-xs text-[var(--pyre-gold)]">
                              ⚠ {SYNC_FLAG_LABELS[shift.sync_flag]}
                            </span>
                          )}
                          {noLead && (
                            <span
                              className="rounded bg-[var(--pyre-gold)]/20 px-2 py-0.5 font-mono text-xs text-[var(--pyre-gold)]"
                              title="Nobody on this shift is a founder or shift lead"
                            >
                              ⚠ no shift lead
                            </span>
                          )}
                          {requests.length > 0 && (
                            <span className="rounded bg-[var(--pyre-blue)]/25 px-2 py-0.5 font-mono text-xs text-[var(--pyre-creme)]">
                              {canManage
                                ? `${requests.length} request${requests.length > 1 ? 's' : ''}`
                                : 'requested'}
                            </span>
                          )}
                          {subs.length > 0 && (
                            <span
                              className="rounded bg-[var(--pyre-gold)]/20 px-2 py-0.5 font-mono text-xs text-[var(--pyre-gold)]"
                              title="Someone on this shift requested a sub — open the shift to take it"
                            >
                              sub needed
                            </span>
                          )}
                          <span className="text-sm text-white/70">
                            {selfFirst(shift.assignments, selfId).map((a, i) => (
                              <Fragment key={a.id}>
                                {i > 0 && ', '}
                                <span className={a.staff_id === selfId ? selfNameClass : undefined}>
                                  {staffById.get(a.staff_id)?.display_name ?? '?'}
                                </span>
                              </Fragment>
                            ))}
                          </span>
                          {notes && (
                            <span className="font-mono text-xs text-white/40">{notes}</span>
                          )}
                        </button>
                        {shift.is_draft && (
                          <span className="flex gap-1">
                            <button
                              type="button"
                              className={buttonClass}
                              title="Accept this shift"
                              disabled={busy}
                              onClick={() =>
                                void proposalAction({
                                  action: 'accept-item',
                                  kind: 'shift',
                                  id: shift.id,
                                })
                              }
                            >
                              ✓
                            </button>
                            <button
                              type="button"
                              className={`${buttonClass} text-[var(--pyre-red)]`}
                              title="Reject this shift"
                              disabled={busy}
                              onClick={() =>
                                void proposalAction({
                                  action: 'reject-item',
                                  kind: 'shift',
                                  id: shift.id,
                                })
                              }
                            >
                              ✗
                            </button>
                          </span>
                        )}
                      </div>

                      {expanded && (
                        <ShiftDetail
                          shift={shift}
                          data={data as BoardData}
                          staffById={staffById}
                          weekHours={weekHoursByWeek[weekStartOf(shift.shift_date)] ?? {}}
                          busy={busy}
                          run={run}
                          canManage={canManage}
                          selfId={selfId}
                          requests={requests}
                          subs={subs}
                          settings={settings}
                          onEdit={() => openEditShift(shift)}
                          editingAssignment={editingAssignment}
                          setEditingAssignment={setEditingAssignment}
                          proposalAction={proposalAction}
                        />
                      )}

                      {formTarget === `edit:${shift.id}` && (
                        <div className="px-3 pb-3">
                          <ShiftForm
                            form={form}
                            setForm={setForm}
                            onSubmit={submitShiftForm}
                            onCancel={() => setFormTarget(null)}
                            busy={busy}
                            shift={shift}
                            run={run}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ShiftForm({
  form,
  setForm,
  onSubmit,
  onCancel,
  busy,
  shift,
  run,
}: {
  form: ShiftFormState;
  setForm: (f: ShiftFormState) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
  /** Present when editing an existing shift — enables cancel/delete actions. */
  shift?: BoardShift;
  run?: (action: () => Promise<{ error?: string }>) => Promise<void>;
}) {
  return (
    <div className="mb-2 space-y-2 rounded border border-white/10 bg-white/5 p-3">
      <div className="flex flex-wrap gap-2">
        {SHIFT_LABEL_SUGGESTIONS.map((label) => (
          <button
            key={label}
            type="button"
            className={pillClass(form.label === label)}
            onClick={() => setForm({ ...form, label })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input
          className={inputClass}
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
          placeholder="Label"
          aria-label="Label"
        />
        <input
          type="time"
          step={1800}
          className={inputClass}
          value={form.startsAt}
          onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
          aria-label="Start time"
        />
        <input
          type="time"
          step={1800}
          className={inputClass}
          value={form.endsAt}
          onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
          aria-label="End time"
        />
        <input
          type="number"
          min={0}
          max={20}
          className={inputClass}
          value={form.staffNeeded}
          onChange={(e) => setForm({ ...form, staffNeeded: e.target.value })}
          aria-label="Staff needed"
        />
      </div>
      <input
        className={inputClass}
        value={form.notes}
        onChange={(e) => setForm({ ...form, notes: e.target.value })}
        placeholder="Notes"
        aria-label="Notes"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass} onClick={onSubmit} disabled={busy}>
          {shift ? 'Save' : 'Add shift'}
        </button>
        <button type="button" className={buttonClass} onClick={onCancel} disabled={busy}>
          Close
        </button>
        {shift && run && (
          <>
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => {
                onCancel();
                void run(() =>
                  api('PATCH', '/api/admin/shifts', {
                    id: shift.id,
                    status: shift.status === 'cancelled' ? 'active' : 'cancelled',
                  })
                );
              }}
            >
              {shift.status === 'cancelled' ? 'Reinstate' : 'Cancel shift'}
            </button>
            <button
              type="button"
              className={`${buttonClass} text-[var(--pyre-red)]`}
              disabled={busy}
              onClick={() => {
                if (!window.confirm('Delete this shift and its assignments?')) return;
                onCancel();
                void run(() => api('DELETE', `/api/admin/shifts?id=${shift.id}`));
              }}
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ShiftDetail({
  shift,
  data,
  staffById,
  weekHours,
  busy,
  run,
  canManage,
  selfId,
  requests,
  subs,
  settings,
  onEdit,
  editingAssignment,
  setEditingAssignment,
  proposalAction,
}: {
  shift: BoardShift;
  data: BoardData;
  staffById: Map<string, StaffRow>;
  weekHours: Record<string, number>;
  busy: boolean;
  run: (action: () => Promise<{ error?: string }>) => Promise<void>;
  canManage: boolean;
  selfId: string | null;
  /** Pending requests on this shift (own only for non-managers). */
  requests: ShiftRequestRow[];
  /** Open sub requests on this shift. */
  subs: SubRequestRow[];
  settings: BoardSettings;
  onEdit: () => void;
  editingAssignment: string | null;
  setEditingAssignment: (id: string | null) => void;
  proposalAction: (body: Record<string, unknown>) => Promise<void>;
}) {
  const startMin = timeToMinutes(shift.starts_at);
  const endMin = timeToMinutes(shift.ends_at);
  const assignedIds = new Set(shift.assignments.map((a) => a.staff_id));
  const candidates = data.staff.filter((s) => s.active && !assignedIds.has(s.id));

  // Employee self-service: these actions only make sense on live, upcoming
  // shifts, and requesting sits behind its admin toggle.
  const upcoming = shift.status === 'active' && !shift.is_draft && shift.shift_date >= todayLocal();
  const selfRequest = selfId ? (requests.find((r) => r.staff_id === selfId) ?? null) : null;
  const canRequest =
    !canManage && settings.shiftRequestsEnabled && upcoming && !!selfId && !assignedIds.has(selfId);

  // The first open sub request someone else made — what "Take this shift"
  // claims. (In practice there's at most one per shift.)
  const takeableSub =
    selfId && upcoming && !assignedIds.has(selfId)
      ? (subs.find((s) => s.requester_staff_id !== selfId) ?? null)
      : null;

  const requestSub = () => {
    if (
      !window.confirm(
        'Request a sub for this shift? Your hours are logged as time off, the admins are emailed, and everyone available that day gets a one-click link to take the shift. You stay on the shift until someone takes it.'
      )
    ) {
      return;
    }
    void run(() => api('POST', '/api/admin/shift-sub', { shiftId: shift.id }));
  };

  const cancelSub = (sub: SubRequestRow) => {
    if (
      !window.confirm(
        'Cancel this sub request? The time off it logged is removed and the shift stays as-is.'
      )
    ) {
      return;
    }
    void run(() => api('DELETE', `/api/admin/shift-sub?id=${sub.id}`));
  };

  const takeSub = (sub: SubRequestRow) => {
    if (
      !window.confirm(
        `Take this shift (${formatTime(sub.starts_at)}–${formatTime(sub.ends_at)})? You replace ${
          staffById.get(sub.requester_staff_id)?.display_name ?? 'the requester'
        } right away.`
      )
    ) {
      return;
    }
    void run(() => api('PATCH', '/api/admin/shift-sub', { id: sub.id, action: 'claim' }));
  };

  return (
    <div className="space-y-3 border-t border-white/10 px-3 py-3">
      {shift.assignments.length > 0 && (
        <ul className="space-y-1.5">
          {selfFirst(shift.assignments, selfId).map((a) => {
            const person = staffById.get(a.staff_id);
            const isSelf = a.staff_id === selfId;
            const personSub = subs.find((s) => s.requester_staff_id === a.staff_id) ?? null;
            const availability = availabilityFor(
              data.timeOff,
              a.staff_id,
              shift.shift_date,
              timeToMinutes(a.starts_at),
              timeToMinutes(a.ends_at)
            );
            const editing = editingAssignment === a.id;
            return (
              <li
                key={a.id}
                className={`rounded px-2 py-1.5 ${isSelf ? 'bg-[var(--pyre-gold)]/10' : 'bg-white/5'}`}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={isSelf ? selfNameClass : 'font-medium'}>
                    {person?.display_name ?? '?'}
                  </span>
                  <span className="font-mono text-xs text-white/60">
                    {formatTime(a.starts_at)}–{formatTime(a.ends_at)} ·{' '}
                    {assignmentHours(a.starts_at, a.ends_at)}h · {ASSIGNMENT_ROLE_LABELS[a.role]}
                  </span>
                  {a.is_draft && (
                    <span className="rounded bg-[var(--pyre-blue)]/25 px-1.5 py-0.5 font-mono text-[10px] text-[var(--pyre-creme)]">
                      ✦ AI draft
                    </span>
                  )}
                  {availability.status !== 'free' && (
                    <span className="font-mono text-xs text-[var(--pyre-red)]">
                      ⚠ time off:{' '}
                      {availability.conflicts.map((c) => c.note || 'unavailable').join('; ')}
                    </span>
                  )}
                  {personSub && (
                    <span className="rounded bg-[var(--pyre-gold)]/20 px-1.5 py-0.5 font-mono text-[10px] text-[var(--pyre-gold)]">
                      sub requested
                      {personSub.notified_count > 0 && ` · ${personSub.notified_count} asked`}
                    </span>
                  )}
                  {a.notes && <span className="font-mono text-xs text-white/40">{a.notes}</span>}
                  <span className="ml-auto flex items-center gap-2">
                    {isSelf &&
                      !a.is_draft &&
                      upcoming &&
                      settings.subRequestsEnabled &&
                      !personSub && (
                        <button
                          type="button"
                          className="font-mono text-xs text-[var(--pyre-gold)] underline disabled:opacity-40"
                          title="Ask for a sub — logs the date as time off, emails the admins, and emails everyone available a link to take the shift"
                          disabled={busy}
                          onClick={requestSub}
                        >
                          request a sub
                        </button>
                      )}
                    {(isSelf || canManage) && personSub && (
                      <button
                        type="button"
                        className="font-mono text-xs text-white/50 underline hover:text-white disabled:opacity-40"
                        title="Cancel the sub request and remove the time off it logged"
                        disabled={busy}
                        onClick={() => cancelSub(personSub)}
                      >
                        cancel sub
                      </button>
                    )}
                    {canManage && a.is_draft && (
                      <>
                        <button
                          type="button"
                          className="font-mono text-xs text-[var(--pyre-sage)] underline"
                          title="Accept this assignment"
                          disabled={busy}
                          onClick={() =>
                            void proposalAction({
                              action: 'accept-item',
                              kind: 'assignment',
                              id: a.id,
                            })
                          }
                        >
                          accept
                        </button>
                        <button
                          type="button"
                          className="font-mono text-xs text-[var(--pyre-red)] underline"
                          title="Reject this assignment"
                          disabled={busy}
                          onClick={() =>
                            void proposalAction({
                              action: 'reject-item',
                              kind: 'assignment',
                              id: a.id,
                            })
                          }
                        >
                          reject
                        </button>
                      </>
                    )}
                    {canManage && (
                      <>
                        <button
                          type="button"
                          className="font-mono text-xs text-white/50 underline hover:text-white"
                          onClick={() => setEditingAssignment(editing ? null : a.id)}
                        >
                          {editing ? 'close' : 'edit'}
                        </button>
                        <button
                          type="button"
                          className="font-mono text-xs text-white/50 underline hover:text-[var(--pyre-red)]"
                          disabled={busy}
                          onClick={() =>
                            void run(() => api('DELETE', `/api/admin/shift-assignments?id=${a.id}`))
                          }
                        >
                          remove
                        </button>
                      </>
                    )}
                  </span>
                </div>
                {editing && (
                  <AssignmentEditor
                    assignment={a}
                    shift={shift}
                    busy={busy}
                    onSave={async (fields) => {
                      setEditingAssignment(null);
                      await run(() =>
                        api('PATCH', '/api/admin/shift-assignments', { id: a.id, ...fields })
                      );
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage && requests.length > 0 && (
        <div>
          <p className="mb-1.5 font-mono text-xs uppercase tracking-wide text-white/40">
            Shift requests
          </p>
          <ul className="space-y-1.5">
            {requests.map((r) => {
              const availability = availabilityFor(
                data.timeOff,
                r.staff_id,
                shift.shift_date,
                startMin,
                endMin
              );
              const badge = availabilityBadge(availability);
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded bg-[var(--pyre-blue)]/10 px-2 py-1.5"
                >
                  <span className="font-medium">
                    {staffById.get(r.staff_id)?.display_name ?? '?'}
                  </span>
                  <span className="font-mono text-xs text-white/50">
                    asked {new Date(r.created_at).toLocaleDateString()}
                  </span>
                  <span className={`font-mono text-xs ${badge.className}`}>{badge.label}</span>
                  {r.note && <span className="font-mono text-xs text-white/40">{r.note}</span>}
                  <span className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      className="font-mono text-xs text-[var(--pyre-sage)] underline disabled:opacity-40"
                      title="Approve — puts them on the shift"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          api('PATCH', '/api/admin/shift-requests', {
                            id: r.id,
                            action: 'approve',
                          })
                        )
                      }
                    >
                      approve
                    </button>
                    <button
                      type="button"
                      className="font-mono text-xs text-[var(--pyre-red)] underline disabled:opacity-40"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          api('PATCH', '/api/admin/shift-requests', { id: r.id, action: 'deny' })
                        )
                      }
                    >
                      deny
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {takeableSub && (
        <div className="flex flex-wrap items-center gap-2 rounded bg-[var(--pyre-gold)]/10 px-2 py-1.5">
          <span className="font-mono text-xs text-[var(--pyre-gold)]">
            {staffById.get(takeableSub.requester_staff_id)?.display_name ?? 'Someone'} needs a sub
            for {formatTime(takeableSub.starts_at)}–{formatTime(takeableSub.ends_at)} — first come,
            first served.
          </span>
          <button
            type="button"
            className={`${buttonClass} border-[var(--pyre-gold)]/50 text-[var(--pyre-gold)]`}
            disabled={busy}
            onClick={() => takeSub(takeableSub)}
          >
            Take this shift
          </button>
        </div>
      )}

      {canRequest && (
        <div className="flex flex-wrap items-center gap-2">
          {selfRequest ? (
            <>
              <span className="font-mono text-xs text-[var(--pyre-creme)]">
                Requested — waiting for a manager to approve.
              </span>
              <button
                type="button"
                className={buttonClass}
                disabled={busy}
                onClick={() =>
                  void run(() => api('DELETE', `/api/admin/shift-requests?id=${selfRequest.id}`))
                }
              >
                Withdraw request
              </button>
            </>
          ) : (
            <button
              type="button"
              className={`${buttonClass} border-[var(--pyre-sage)]/50 text-[var(--pyre-sage)]`}
              disabled={busy}
              onClick={() =>
                void run(() => api('POST', '/api/admin/shift-requests', { shiftId: shift.id }))
              }
            >
              Request this shift
            </button>
          )}
        </div>
      )}

      {canManage && candidates.length > 0 && shift.status === 'active' && (
        <div>
          <p className="mb-1.5 font-mono text-xs uppercase tracking-wide text-white/40">
            Add person
          </p>
          <div className="flex flex-wrap gap-2">
            {candidates.map((s) => {
              const availability = availabilityFor(
                data.timeOff,
                s.id,
                shift.shift_date,
                startMin,
                endMin
              );
              const badge = availabilityBadge(availability);
              const conflictNote = availability.conflicts
                .map((c) => {
                  const when = c.wholeDay
                    ? 'all day'
                    : `${formatTime(minutesToTime(c.startMin))}–${formatTime(minutesToTime(c.endMin))}`;
                  return c.note ? `${when}: ${c.note}` : when;
                })
                .join('; ');
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={busy}
                  className="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-left text-sm hover:border-white/30 disabled:opacity-40"
                  title={
                    availability.status === 'free'
                      ? undefined
                      : availability.conflicts.map((c) => c.note || 'unavailable').join('; ')
                  }
                  onClick={() =>
                    void run(() =>
                      api('POST', '/api/admin/shift-assignments', {
                        shiftId: shift.id,
                        staffId: s.id,
                      })
                    )
                  }
                >
                  <span className="font-medium">{s.display_name}</span>{' '}
                  <span className={`font-mono text-xs ${badge.className}`}>{badge.label}</span>{' '}
                  <span className="font-mono text-xs text-white/40">
                    {(weekHours[s.id] ?? 0).toFixed(1)}h wk
                  </span>
                  {availability.status !== 'free' && conflictNote && (
                    <span className="block font-mono text-[10px] text-white/40">
                      {conflictNote}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {canManage && (
        <button type="button" className={buttonClass} onClick={onEdit}>
          Edit shift
        </button>
      )}
    </div>
  );
}

function AssignmentEditor({
  assignment,
  shift,
  busy,
  onSave,
}: {
  assignment: ShiftAssignmentRow;
  shift: BoardShift;
  busy: boolean;
  onSave: (fields: { startsAt: string; endsAt: string; role: AssignmentRole }) => Promise<void>;
}) {
  const [startsAt, setStartsAt] = useState(hhmm(assignment.starts_at));
  const [endsAt, setEndsAt] = useState(hhmm(assignment.ends_at));
  const [role, setRole] = useState<AssignmentRole>(assignment.role);

  // Full/Setup snap the times to the shift window. The window already carries
  // the buffers (90min lead before the first session, 30min close after the
  // last — schedule-core's DEFAULT_WINDOW_OPTIONS), so full = the whole
  // window and setup = its first 2h, i.e. through 30min past session start.
  // Partial only marks the role — its times stay hand-entered.
  const applyRole = (r: AssignmentRole) => {
    setRole(r);
    if (r === 'full') {
      setStartsAt(hhmm(shift.starts_at));
      setEndsAt(hhmm(shift.ends_at));
    } else if (r === 'setup') {
      const startMin = timeToMinutes(shift.starts_at);
      const endMin = timeToMinutes(shift.ends_at);
      setStartsAt(hhmm(shift.starts_at));
      setEndsAt(minutesToTime(Math.min(startMin + SETUP_DURATION_MIN, endMin)));
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input
        type="time"
        step={1800}
        className={`${inputClass} w-auto`}
        value={startsAt}
        onChange={(e) => setStartsAt(e.target.value)}
        aria-label="Assignment start"
      />
      <input
        type="time"
        step={1800}
        className={`${inputClass} w-auto`}
        value={endsAt}
        onChange={(e) => setEndsAt(e.target.value)}
        aria-label="Assignment end"
      />
      {ASSIGNMENT_ROLES.map((r) => (
        <button
          key={r}
          type="button"
          className={pillClass(role === r)}
          onClick={() => applyRole(r)}
        >
          {ASSIGNMENT_ROLE_LABELS[r]}
        </button>
      ))}
      <button
        type="button"
        className={buttonClass}
        disabled={busy}
        onClick={() => void onSave({ startsAt, endsAt, role })}
      >
        Save
      </button>
    </div>
  );
}

function ProposalBanner({
  proposal,
  busy,
  onAction,
}: {
  proposal: ScheduleProposalRow;
  busy: boolean;
  onAction: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [showRationale, setShowRationale] = useState(true);
  const summary = proposal.summary as {
    uncoveredShifts?: number;
    partialAvailabilityPlacements?: number;
    warnings?: string[];
  };

  return (
    <section className="rounded-lg border border-[var(--pyre-blue)]/50 bg-[var(--pyre-blue)]/10 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-mono text-xs font-bold uppercase tracking-wide text-[var(--pyre-creme)]">
          ✦ AI draft — week of {proposal.week_start}
        </span>
        <span className="font-mono text-[10px] text-white/50">
          {proposal.source === 'cron' ? 'weekly auto-draft' : 'manual draft'} ·{' '}
          {new Date(proposal.created_at).toLocaleString()}
        </span>
        {(summary.uncoveredShifts ?? 0) > 0 && (
          <span className="rounded bg-[var(--pyre-gold)]/20 px-2 py-0.5 font-mono text-[10px] text-[var(--pyre-gold)]">
            {summary.uncoveredShifts} under-staffed
          </span>
        )}
        {(summary.partialAvailabilityPlacements ?? 0) > 0 && (
          <span className="rounded bg-[var(--pyre-gold)]/20 px-2 py-0.5 font-mono text-[10px] text-[var(--pyre-gold)]">
            {summary.partialAvailabilityPlacements} partial-availability
          </span>
        )}
        <span className="ml-auto flex gap-2">
          <button
            type="button"
            className={buttonClass}
            onClick={() => setShowRationale(!showRationale)}
          >
            {showRationale ? 'Hide notes' : 'Notes'}
          </button>
          <button
            type="button"
            className={`${buttonClass} border-[var(--pyre-sage)]/60 text-[var(--pyre-sage)]`}
            disabled={busy}
            onClick={() => void onAction({ action: 'approve', proposalId: proposal.id })}
          >
            Approve week
          </button>
          <button
            type="button"
            className={`${buttonClass} text-[var(--pyre-red)]`}
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  'Discard the whole draft? Individual ✓/✗ is also available on each item.'
                )
              ) {
                void onAction({ action: 'discard', proposalId: proposal.id });
              }
            }}
          >
            Discard
          </button>
        </span>
      </div>
      {(summary.warnings ?? []).length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {(summary.warnings ?? []).map((w) => (
            <li key={w} className="font-mono text-[10px] text-[var(--pyre-gold)]">
              ⚠ {w}
            </li>
          ))}
        </ul>
      )}
      {showRationale && proposal.rationale && (
        <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded bg-black/20 p-2 font-mono text-xs leading-relaxed text-white/80">
          {proposal.rationale}
        </pre>
      )}
      <p className="mt-2 font-mono text-[10px] text-white/40">
        Dashed cards and "AI draft" chips are proposals — edit them like normal entries, ✓/✗
        individually, or approve the whole week. Nothing is live until accepted.
      </p>
    </section>
  );
}
