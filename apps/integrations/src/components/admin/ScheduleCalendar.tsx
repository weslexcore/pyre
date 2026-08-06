// Month calendar: the whole month as a Monday-start grid, shifts as
// coverage-colored blocks in each day cell (label, window, who's on) and time
// off as per-person colored markers along the cell bottom — so the month's
// shape and everyone's availability read at a glance. Days the viewer works
// are tinted gold, with their own name first in the block. Read-only; editing
// happens on the Week board.

import {
  addDays,
  busyIntervalsFor,
  minutesToTime,
  timeToMinutes,
  weekStartOf,
} from '@pyre/schedule-core';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { ShiftAssignmentRow, ShiftRow, StaffRow, TimeOffRow } from '@/lib/db';

interface BoardShift extends ShiftRow {
  assignments: ShiftAssignmentRow[];
}

interface BoardData {
  staff: StaffRow[];
  shifts: BoardShift[];
  timeOff: TimeOffRow[];
  selfStaffId?: string | null;
}

const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

// Distinct per-person hues for the time-off markers, assigned by roster order.
const PERSON_COLORS = [
  '#e0685c',
  '#5c9de0',
  '#e0b55c',
  '#7fc98a',
  '#b58ce0',
  '#5cc9c0',
  '#e08cb5',
  '#a8b55c',
];

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const todayLocal = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
};

/** First day of the month containing a YYYY-MM-DD date. */
const monthStartOf = (date: string): string => `${date.slice(0, 7)}-01`;

const addMonths = (monthStart: string, delta: number): string => {
  const [y, m] = monthStart.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}-01`;
};

/** Last day of the month, as YYYY-MM-DD. */
const monthEndOf = (monthStart: string): string => addDays(addMonths(monthStart, 1), -1);

const formatMonth = (monthStart: string): string => {
  const [y, m] = monthStart.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};

const formatTime = (t: string): string => {
  const min = timeToMinutes(t);
  const h = Math.floor(min / 60);
  const m = min % 60;
  const suffix = h < 12 ? 'a' : 'p';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
};

type CoverageTone = 'empty' | 'under' | 'covered' | 'cancelled';

const coverageTone = (shift: BoardShift): CoverageTone => {
  if (shift.status === 'cancelled') return 'cancelled';
  if (shift.assignments.length === 0 && shift.staff_needed > 0) return 'empty';
  if (shift.assignments.length < shift.staff_needed) return 'under';
  return 'covered';
};

/** The viewer's own assignment reads first in a shift's name list. */
const selfFirst = <T extends { staff_id: string }>(
  rows: readonly T[],
  selfId: string | null
): T[] =>
  selfId
    ? [...rows].sort((a, b) => Number(b.staff_id === selfId) - Number(a.staff_id === selfId))
    : [...rows];

const toneBlock: Record<CoverageTone, string> = {
  empty: 'border-[var(--pyre-red)]/70 bg-[var(--pyre-red)]/15',
  under: 'border-[var(--pyre-gold)]/70 bg-[var(--pyre-gold)]/15',
  covered: 'border-[var(--pyre-sage)]/60 bg-[var(--pyre-sage)]/15',
  cancelled: 'border-white/15 bg-white/5 opacity-50',
};

export function ScheduleCalendar() {
  const [monthStart, setMonthStart] = useState(() => monthStartOf(todayLocal()));
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The visible grid runs from the Monday on/before the 1st through the
  // Sunday on/after the month's last day.
  const gridStart = useMemo(() => weekStartOf(monthStart), [monthStart]);
  const gridEnd = useMemo(() => addDays(weekStartOf(monthEndOf(monthStart)), 6), [monthStart]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/schedule-board?start=${gridStart}&end=${gridEnd}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as BoardData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [gridStart, gridEnd]);

  useEffect(() => {
    void load();
  }, [load]);

  const weeks = useMemo(() => {
    const result: string[][] = [];
    for (let day = gridStart; day <= gridEnd; day = addDays(day, 7)) {
      result.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
    }
    return result;
  }, [gridStart, gridEnd]);

  const staffById = useMemo(() => new Map((data?.staff ?? []).map((s) => [s.id, s])), [data]);

  const personColor = useMemo(() => {
    const map = new Map<string, string>();
    (data?.staff ?? []).forEach((s, i) => {
      map.set(s.id, PERSON_COLORS[i % PERSON_COLORS.length]);
    });
    return map;
  }, [data]);

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, BoardShift[]>();
    for (const shift of data?.shifts ?? []) {
      const list = map.get(shift.shift_date) ?? [];
      list.push(shift);
      map.set(shift.shift_date, list);
    }
    return map;
  }, [data]);

  const selfId = data?.selfStaffId ?? null;

  // Days the viewer is on the schedule — those cells get the gold treatment.
  const selfDates = useMemo(() => {
    const dates = new Set<string>();
    if (!selfId) return dates;
    for (const shift of data?.shifts ?? []) {
      if (shift.status === 'cancelled') continue;
      if (shift.assignments.some((a) => a.staff_id === selfId)) dates.add(shift.shift_date);
    }
    return dates;
  }, [data, selfId]);

  // Per-day time-off markers: every active person with any busy interval.
  const timeOffByDate = useMemo(() => {
    const map = new Map<string, Array<{ staff: StaffRow; color: string; detail: string }>>();
    if (!data) return map;
    const activeStaff = data.staff.filter((s) => s.active);
    for (const week of weeks) {
      for (const date of week) {
        const markers: Array<{ staff: StaffRow; color: string; detail: string }> = [];
        for (const person of activeStaff) {
          const intervals = busyIntervalsFor(data.timeOff, person.id, date);
          if (intervals.length === 0) continue;
          const detail = intervals
            .map((b) => {
              const when = b.wholeDay
                ? 'all day'
                : `${minutesToTime(b.startMin)}–${minutesToTime(b.endMin)}`;
              return b.note ? `${when}: ${b.note}` : when;
            })
            .join('; ');
          markers.push({
            staff: person,
            color: personColor.get(person.id) ?? PERSON_COLORS[0],
            detail,
          });
        }
        if (markers.length > 0) map.set(date, markers);
      }
    }
    return map;
  }, [data, weeks, personColor]);

  if (loading && !data) {
    return <p className="font-mono text-sm text-white/40">Loading calendar…</p>;
  }

  const today = todayLocal();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
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
        <span className="font-mono text-xl font-bold text-white/80">{formatMonth(monthStart)}</span>
        {loading && <span className="font-mono text-xs text-white/40">Loading…</span>}
      </div>

      {error && (
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-red)]">
          {error}
        </p>
      )}

      <div className="overflow-x-auto">
        <div className="min-w-[860px]">
          <div className="grid grid-cols-7">
            {WEEKDAY_HEADERS.map((label) => (
              <div
                key={label}
                className="border-b border-white/10 px-2 py-1.5 font-mono text-xs font-bold uppercase tracking-wide text-white/50"
              >
                {label}
              </div>
            ))}
          </div>

          {weeks.map((week) => (
            <div key={week[0]} className="grid grid-cols-7">
              {week.map((date) => {
                const inMonth = date.slice(0, 7) === monthStart.slice(0, 7);
                const shifts = shiftsByDate.get(date) ?? [];
                const markers = timeOffByDate.get(date) ?? [];
                const selfWorks = selfDates.has(date);
                const cellTone = selfWorks
                  ? 'bg-[var(--pyre-gold)]/[0.08] ring-1 ring-inset ring-[var(--pyre-gold)]/40'
                  : inMonth
                    ? ''
                    : 'bg-white/[0.02]';
                return (
                  <div
                    key={date}
                    className={`min-h-[110px] border-b border-l border-white/10 p-1.5 last:border-r ${cellTone} ${
                      inMonth ? '' : 'opacity-40'
                    }`}
                  >
                    <div
                      className={`mb-1 text-right font-mono text-[11px] ${
                        date === today
                          ? 'font-bold text-[var(--pyre-red)]'
                          : selfWorks
                            ? 'font-bold text-[var(--pyre-gold)]'
                            : 'text-white/40'
                      }`}
                    >
                      {Number(date.slice(8))}
                    </div>

                    <div className="space-y-1">
                      {shifts.map((shift) => {
                        const assigned = selfFirst(shift.assignments, selfId);
                        const names = assigned
                          .map((a) => staffById.get(a.staff_id)?.display_name ?? '?')
                          .join(', ');
                        return (
                          <a
                            key={shift.id}
                            href="/admin/schedule"
                            title={`${shift.label} ${formatTime(shift.starts_at)}–${formatTime(shift.ends_at)} · ${shift.assignments.length}/${shift.staff_needed}${names ? ` · ${names}` : ''}${shift.notes ? ` · ${shift.notes}` : ''}`}
                            className={`block overflow-hidden rounded border px-1.5 py-1 ${toneBlock[coverageTone(shift)]}`}
                          >
                            <span className="block truncate text-[11px] font-semibold leading-tight">
                              {formatTime(shift.starts_at)}–{formatTime(shift.ends_at)}{' '}
                              {shift.label}
                              {shift.status === 'cancelled' && ' ✕'}
                            </span>
                            <span className="block truncate font-mono text-[10px] text-white/70 leading-tight">
                              {shift.assignments.length}/{shift.staff_needed}
                              {assigned.map((a, i) => (
                                <Fragment key={a.id}>
                                  {i === 0 ? ' · ' : ', '}
                                  <span
                                    className={
                                      a.staff_id === selfId
                                        ? 'font-bold text-[var(--pyre-gold)]'
                                        : undefined
                                    }
                                  >
                                    {staffById.get(a.staff_id)?.display_name ?? '?'}
                                  </span>
                                </Fragment>
                              ))}
                            </span>
                          </a>
                        );
                      })}
                    </div>

                    {markers.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {markers.map((marker) => (
                          <span
                            key={marker.staff.id}
                            title={`${marker.staff.display_name} off — ${marker.detail}`}
                            className="rounded-sm px-1 font-mono text-[9px] leading-4"
                            style={{
                              color: marker.color,
                              backgroundColor: `${marker.color}22`,
                              border: `1px solid ${marker.color}55`,
                            }}
                          >
                            {marker.staff.display_name[0]}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-white/50">
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-[var(--pyre-red)]/70 bg-[var(--pyre-red)]/15 align-middle" />
          empty
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-[var(--pyre-gold)]/70 bg-[var(--pyre-gold)]/15 align-middle" />
          under staffed
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-[var(--pyre-sage)]/60 bg-[var(--pyre-sage)]/15 align-middle" />
          covered
        </span>
        {selfId && (
          <span className="text-[var(--pyre-gold)]">
            <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[var(--pyre-gold)]/25 ring-1 ring-inset ring-[var(--pyre-gold)]/60 align-middle" />
            days you work
          </span>
        )}
        <span className="text-white/40">· lettered chips = time off:</span>
        {(data?.staff ?? [])
          .filter((s) => s.active)
          .map((s) => (
            <span key={s.id} style={{ color: personColor.get(s.id) }}>
              ▪ {s.display_name}
            </span>
          ))}
      </div>
    </div>
  );
}
