// Availability finder for /admin/schedule/availability: pick people and a
// time window, scan a date range for the days everyone can work — treating
// both time off and existing shift assignments as busy — and turn a chosen
// day into a real shift with everyone assigned. All computation happens here
// over one schedule-board fetch; creation goes through the existing
// /api/admin/shifts and /api/admin/shift-assignments routes.
import {
  type AvailabilityStatus,
  addDays,
  busyIntervalsFor,
  canLeadShift,
  coverageStatus,
  DOW_LABELS,
  firstTentativeDate,
  founderIdsOf,
  labelForWindow,
  minutesToTime,
  rollupHours,
  timeToMinutes,
  type WindowInterval,
  weekStartOf,
} from '@pyre/schedule-core';
import { useMemo, useState } from 'react';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import type { ScheduleBoardPayload } from '@/pages/api/admin/schedule-board';
import { StaffMultiSelect } from './StaffMultiSelect';

const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

const inputClass =
  'px-3 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30';

const todayLocal = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

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

/** Longest range one scan will cover — plenty of horizon, still instant. */
const MAX_RANGE_DAYS = 120;
const DEFAULT_RANGE_DAYS = 42;
/** Partial matches shown below the perfect ones. */
const MAX_PARTIAL_SHOWN = 15;

const statusClass: Record<AvailabilityStatus, string> = {
  free: 'text-[var(--pyre-sage)]',
  partial: 'text-[var(--pyre-gold)]',
  busy: 'text-[var(--pyre-red)]',
};

const statusLabel: Record<AvailabilityStatus, string> = {
  free: 'free',
  partial: 'partial',
  busy: 'unavailable',
};

interface PersonStatus {
  staffId: string;
  name: string;
  status: AvailabilityStatus;
  /** Human-readable conflicts, tagged by where they come from. */
  reasons: string[];
}

interface CandidateDay {
  date: string;
  statuses: PersonStatus[];
  freeCount: number;
  allFree: boolean;
  /** Past the two-week commitment horizon — times may still move. */
  tentative: boolean;
  dayShiftCount: number;
  /** Active shifts whose window overlaps the searched one — duplicate risk. */
  overlappingShiftCount: number;
  /** Selected people's already-scheduled hours in this date's week. */
  weekLoadHours: number;
  /** Some free selected person can anchor the shift. */
  hasLead: boolean;
}

interface CreateResult {
  kind: 'success' | 'partial' | 'error';
  message: string;
  boardHref?: string;
}

/**
 * Like the board's api() helper, but returns the parsed response body — the
 * create flow needs the new shift's id to assign people to it.
 */
async function apiJson<T>(
  path: string,
  body: Record<string, unknown>
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // no body
  }
  if (res.ok) {
    invalidateJson('/api/admin/schedule-board');
    return { ok: true, data: parsed as T };
  }
  return {
    ok: false,
    status: res.status,
    error: (parsed as { error?: string } | null)?.error ?? `HTTP ${res.status}`,
  };
}

interface CreateFormState {
  label: string;
  staffNeeded: string;
  notes: string;
}

export function ScheduleAvailability() {
  const today = todayLocal();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [startTime, setStartTime] = useState('14:30');
  const [endTime, setEndTime] = useState('20:30');
  const [searchStart, setSearchStart] = useState(() => addDays(todayLocal(), 1));
  const [searchEnd, setSearchEnd] = useState(() => addDays(todayLocal(), DEFAULT_RANGE_DAYS));
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [form, setForm] = useState<CreateFormState>({ label: '', staffNeeded: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CreateResult | null>(null);

  const startMin = startTime ? timeToMinutes(startTime) : Number.NaN;
  const endMin = endTime ? timeToMinutes(endTime) : Number.NaN;
  const windowValid = Number.isFinite(startMin) && Number.isFinite(endMin) && endMin > startMin;

  // Clamp the scan to today-onward and a sane length; string compares are
  // safe on YYYY-MM-DD.
  const clampedStart = searchStart && searchStart > today ? searchStart : today;
  const maxEnd = addDays(clampedStart, MAX_RANGE_DAYS - 1);
  const clampedEnd = searchEnd && searchEnd < maxEnd ? searchEnd : maxEnd;
  const rangeValid = Boolean(searchStart && searchEnd && clampedEnd >= clampedStart);

  // Fetch whole Mon–Sun weeks so the week-load tiebreak sees full weeks.
  const url =
    windowValid && rangeValid
      ? `/api/admin/schedule-board?start=${weekStartOf(clampedStart)}&end=${addDays(weekStartOf(clampedEnd), 6)}`
      : null;
  const { data, error, loading, reload } = useCachedJson<ScheduleBoardPayload>(url);

  const effectiveSelected = useMemo(() => {
    if (!data) return [] as string[];
    const active = new Set(data.staff.filter((s) => s.active).map((s) => s.id));
    return [...selected].filter((id) => active.has(id));
  }, [data, selected]);

  const scan = useMemo(() => {
    if (!data || !windowValid || !rangeValid || effectiveSelected.length === 0) return null;

    const staffById = new Map(data.staff.map((s) => [s.id, s]));
    const activeShifts = data.shifts.filter((s) => s.status !== 'cancelled');

    // Existing assignments as busy intervals, keyed by person then date. Uses
    // the assignment's own times, which can differ from the shift window.
    const assignedByStaffDate = new Map<
      string,
      Map<string, Array<WindowInterval & { text: string }>>
    >();
    for (const shift of activeShifts) {
      for (const a of shift.assignments) {
        let byDate = assignedByStaffDate.get(a.staff_id);
        if (!byDate) {
          byDate = new Map();
          assignedByStaffDate.set(a.staff_id, byDate);
        }
        const list = byDate.get(shift.shift_date) ?? [];
        list.push({
          startMin: timeToMinutes(a.starts_at),
          endMin: timeToMinutes(a.ends_at),
          text: `on '${shift.label}' ${formatTime(a.starts_at)}–${formatTime(a.ends_at)}`,
        });
        byDate.set(shift.shift_date, list);
      }
    }

    const shiftsByDate = new Map<string, typeof activeShifts>();
    for (const shift of activeShifts) {
      const list = shiftsByDate.get(shift.shift_date) ?? [];
      list.push(shift);
      shiftsByDate.set(shift.shift_date, list);
    }

    const weeks = rollupHours(
      activeShifts.flatMap((s) =>
        s.assignments.map((a) => ({ assignment: a, shiftDate: s.shift_date }))
      ),
      founderIdsOf(data.staff)
    );
    const weekLoadByStart = new Map(weeks.map((w) => [w.weekStart, w.byStaff]));

    const tentativeFrom = firstTentativeDate(today);
    const days: CandidateDay[] = [];

    for (let date = clampedStart; date <= clampedEnd; date = addDays(date, 1)) {
      const statuses: PersonStatus[] = effectiveSelected.map((staffId) => {
        const off = busyIntervalsFor(data.timeOff, staffId, date);
        const assigned = assignedByStaffDate.get(staffId)?.get(date) ?? [];
        const overlapsWindow = (b: WindowInterval) => b.startMin < endMin && b.endMin > startMin;
        const reasons = [
          ...off.filter(overlapsWindow).map((b) => {
            const when = b.wholeDay
              ? 'all day'
              : `${formatTime(minutesToTime(b.startMin))}–${formatTime(minutesToTime(b.endMin))}`;
            return b.note ? `time off ${when}: ${b.note}` : `time off ${when}`;
          }),
          ...assigned.filter(overlapsWindow).map((b) => b.text),
        ];
        return {
          staffId,
          name: staffById.get(staffId)?.display_name ?? '?',
          status: coverageStatus([...off, ...assigned], startMin, endMin),
          reasons,
        };
      });

      const freeCount = statuses.filter((s) => s.status === 'free').length;
      if (freeCount === 0) continue;

      const dayShifts = shiftsByDate.get(date) ?? [];
      const weekLoad = weekLoadByStart.get(weekStartOf(date)) ?? {};
      days.push({
        date,
        statuses,
        freeCount,
        allFree: freeCount === statuses.length,
        tentative: date >= tentativeFrom,
        dayShiftCount: dayShifts.length,
        overlappingShiftCount: dayShifts.filter(
          (s) => timeToMinutes(s.starts_at) < endMin && timeToMinutes(s.ends_at) > startMin
        ).length,
        weekLoadHours: effectiveSelected.reduce((sum, id) => sum + (weekLoad[id] ?? 0), 0),
        hasLead: statuses.some((s) => {
          const person = staffById.get(s.staffId);
          return s.status === 'free' && person !== undefined && canLeadShift(person);
        }),
      });
    }

    days.sort(
      (a, b) =>
        Number(b.allFree) - Number(a.allFree) ||
        b.freeCount - a.freeCount ||
        a.overlappingShiftCount - b.overlappingShiftCount ||
        a.weekLoadHours - b.weekLoadHours ||
        a.dayShiftCount - b.dayShiftCount ||
        a.date.localeCompare(b.date)
    );

    return {
      perfect: days.filter((d) => d.allFree),
      partial: days.filter((d) => !d.allFree).slice(0, MAX_PARTIAL_SHOWN),
    };
  }, [
    data,
    windowValid,
    rangeValid,
    effectiveSelected,
    clampedStart,
    clampedEnd,
    startMin,
    endMin,
    today,
  ]);

  const openCreate = (date: string) => {
    setOpenDate(date);
    setForm({
      label: labelForWindow(startMin, endMin),
      staffNeeded: String(effectiveSelected.length),
      notes: '',
    });
    setResult(null);
  };

  const submitCreate = async () => {
    if (!openDate || !data) return;
    const staffNeeded = Number(form.staffNeeded);
    setBusy(true);
    setResult(null);

    const shiftRes = await apiJson<{ shift: { id: string } }>('/api/admin/shifts', {
      shiftDate: openDate,
      label: form.label.trim(),
      startsAt: startTime,
      endsAt: endTime,
      staffNeeded,
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
    });
    if (!shiftRes.ok) {
      setResult({ kind: 'error', message: `Couldn't create the shift: ${shiftRes.error}` });
      setBusy(false);
      return;
    }

    // Sequential on purpose: deterministic partial-failure reporting, and no
    // burst against the change log. N is small.
    const staffById = new Map(data.staff.map((s) => [s.id, s]));
    const failed: string[] = [];
    for (const staffId of effectiveSelected) {
      const res = await apiJson('/api/admin/shift-assignments', {
        shiftId: shiftRes.data.shift.id,
        staffId,
      });
      // 409 = already on the shift, which is what we wanted anyway.
      if (!res.ok && res.status !== 409) {
        failed.push(staffById.get(staffId)?.display_name ?? staffId);
      }
    }

    await reload();
    const boardHref = `/admin/schedule?view=week&date=${openDate}&shift=${shiftRes.data.shift.id}`;
    setResult(
      failed.length === 0
        ? {
            kind: 'success',
            message: `Shift created on ${formatDay(openDate)} with ${effectiveSelected.length} ${
              effectiveSelected.length === 1 ? 'person' : 'people'
            } assigned.`,
            boardHref,
          }
        : {
            kind: 'partial',
            message: `Shift created, but couldn't assign: ${failed.join(', ')} — finish on the board.`,
            boardHref,
          }
    );
    setOpenDate(null);
    setBusy(false);
  };

  const staffNeededValid =
    /^\d+$/.test(form.staffNeeded) &&
    Number(form.staffNeeded) >= 0 &&
    Number(form.staffNeeded) <= 20;

  const renderRow = (day: CandidateDay) => (
    <div key={day.date} className="rounded border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-[90px] font-mono text-sm font-semibold text-[var(--pyre-creme)]">
          {formatDay(day.date)}
        </span>
        {day.tentative && (
          <span className="rounded bg-[var(--pyre-gold)]/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)]/80">
            tentative
          </span>
        )}
        {day.overlappingShiftCount > 0 && (
          <span className="rounded bg-[var(--pyre-gold)]/20 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)]">
            overlaps {day.overlappingShiftCount} existing{' '}
            {day.overlappingShiftCount === 1 ? 'shift' : 'shifts'}
          </span>
        )}
        {!day.hasLead && (
          <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-white/50">
            no lead
          </span>
        )}
        <span className="font-mono text-[10px] text-white/40">
          {day.dayShiftCount === 0
            ? 'no shifts that day'
            : `${day.dayShiftCount} ${day.dayShiftCount === 1 ? 'shift' : 'shifts'} that day`}
          {' · '}
          {day.weekLoadHours.toFixed(1)}h scheduled that week
        </span>
        {data?.canManage && (
          <button
            type="button"
            className={`${buttonClass} ml-auto border-[var(--pyre-sage)]/50 text-[var(--pyre-sage)]`}
            disabled={busy}
            onClick={() => (openDate === day.date ? setOpenDate(null) : openCreate(day.date))}
          >
            {openDate === day.date ? 'Close' : 'Create shift'}
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {day.statuses.map((p) => (
          <span
            key={p.staffId}
            className="font-mono text-xs text-white/80"
            title={p.reasons.length > 0 ? p.reasons.join('; ') : undefined}
          >
            {p.name} <span className={statusClass[p.status]}>{statusLabel[p.status]}</span>
          </span>
        ))}
      </div>
      {openDate === day.date && data?.canManage && (
        <div className="mt-3 space-y-2 rounded border border-white/10 bg-white/[0.03] p-3">
          <p className="font-mono text-xs text-white/60">
            {formatDay(day.date)} · {formatTime(startTime)}–{formatTime(endTime)} ·{' '}
            {effectiveSelected.length} {effectiveSelected.length === 1 ? 'person' : 'people'} will
            be assigned
          </p>
          {day.overlappingShiftCount > 0 && (
            <p className="font-mono text-xs text-[var(--pyre-gold)]">
              {day.overlappingShiftCount} existing{' '}
              {day.overlappingShiftCount === 1 ? 'shift overlaps' : 'shifts overlap'} this window on
              this date — creating another may be a duplicate.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${inputClass} w-36`}
              value={form.label}
              maxLength={40}
              placeholder="Label"
              aria-label="Shift label"
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
            <label className="flex items-center gap-1.5 font-mono text-xs text-white/50">
              needed
              <input
                className={`${inputClass} w-16`}
                type="number"
                min={0}
                max={20}
                value={form.staffNeeded}
                aria-label="Staff needed"
                onChange={(e) => setForm({ ...form, staffNeeded: e.target.value })}
              />
            </label>
            <input
              className={`${inputClass} min-w-[180px] flex-1`}
              value={form.notes}
              maxLength={500}
              placeholder="Notes (optional)"
              aria-label="Shift notes"
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={`${buttonClass} border-[var(--pyre-sage)]/50 text-[var(--pyre-sage)]`}
              disabled={busy || form.label.trim().length === 0 || !staffNeededValid}
              onClick={() => void submitCreate()}
            >
              {busy ? 'Creating…' : 'Create shift + assign'}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => setOpenDate(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StaffMultiSelect staff={data?.staff ?? []} selected={selected} onChange={setSelected} />
          <label className="flex items-center gap-1.5 font-mono text-xs text-white/50">
            from
            <input
              className={inputClass}
              type="time"
              step={60 * 30}
              value={startTime}
              aria-label="Window start"
              onChange={(e) => setStartTime(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-1.5 font-mono text-xs text-white/50">
            to
            <input
              className={inputClass}
              type="time"
              step={60 * 30}
              value={endTime}
              aria-label="Window end"
              onChange={(e) => setEndTime(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-1.5 font-mono text-xs text-white/50">
            between
            <input
              className={inputClass}
              type="date"
              min={today}
              value={searchStart}
              aria-label="Search from"
              onChange={(e) => setSearchStart(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-1.5 font-mono text-xs text-white/50">
            and
            <input
              className={inputClass}
              type="date"
              min={today}
              value={searchEnd}
              aria-label="Search until"
              onChange={(e) => setSearchEnd(e.target.value)}
            />
          </label>
        </div>
        {!windowValid && (
          <p className="mt-2 font-mono text-xs text-[var(--pyre-red)]">
            The window end must be after its start.
          </p>
        )}
        {windowValid && !rangeValid && (
          <p className="mt-2 font-mono text-xs text-[var(--pyre-red)]">
            Pick a search range that ends on or after it starts (past dates are skipped).
          </p>
        )}
      </div>

      {result && (
        <div
          className={`rounded border px-4 py-3 font-mono text-sm ${
            result.kind === 'success'
              ? 'border-[var(--pyre-sage)]/50 text-[var(--pyre-sage)]'
              : result.kind === 'partial'
                ? 'border-[var(--pyre-gold)]/50 text-[var(--pyre-gold)]'
                : 'border-[var(--pyre-red)]/50 text-[var(--pyre-red)]'
          }`}
        >
          {result.message}{' '}
          {result.boardHref && (
            <a className="underline hover:text-white" href={result.boardHref}>
              View on the board
            </a>
          )}
        </div>
      )}

      {error && <p className="font-mono text-sm text-[var(--pyre-red)]">{error}</p>}
      {loading && <p className="font-mono text-sm text-white/40">Loading schedule…</p>}

      {data && effectiveSelected.length === 0 && (
        <p className="font-mono text-sm text-white/40">
          Pick at least one person to search for dates.
        </p>
      )}

      {scan && (
        <>
          <div>
            <p className="mb-2 font-mono text-xs uppercase tracking-wide text-white/40">
              Everyone free · {scan.perfect.length} {scan.perfect.length === 1 ? 'date' : 'dates'}
            </p>
            {scan.perfect.length === 0 ? (
              <p className="font-mono text-sm text-white/40">
                No dates where everyone is free — widen the range, shorten the window, or check the
                partial matches below.
              </p>
            ) : (
              <div className="space-y-2">{scan.perfect.map(renderRow)}</div>
            )}
          </div>
          {scan.partial.length > 0 && (
            <div>
              <p className="mb-2 font-mono text-xs uppercase tracking-wide text-white/40">
                Partial matches
              </p>
              <div className="space-y-2">{scan.partial.map(renderRow)}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
