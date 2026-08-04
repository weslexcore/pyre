// Time-off management (the sheet's "Blackouts"): recurring weekly rules and
// trip date-ranges, both optionally time-bounded. Entries auto-approve; the
// panel at the top surfaces any that collide with existing assignments over
// the coming weeks so the admin can re-staff.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScheduleStaffRow, ShiftAssignmentRow, ShiftRow, TimeOffRow } from '@/lib/db';
import { findAssignmentConflicts } from '@/lib/schedule/availability';
import { DOW_LABELS, type TimeOffKind } from '@/lib/schedule/constants';
import { addDays } from '@/lib/schedule/hours';

interface BoardData {
  staff: ScheduleStaffRow[];
  shifts: Array<ShiftRow & { assignments: ShiftAssignmentRow[] }>;
  timeOff: TimeOffRow[];
}

const inputClass =
  'px-3 py-2 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30';

const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

const pillClass = (active: boolean) =>
  `px-2.5 py-1.5 rounded text-xs font-mono uppercase tracking-wide border transition-colors ${
    active
      ? 'border-[var(--pyre-red)] bg-[var(--pyre-red)]/15 text-[var(--pyre-creme)]'
      : 'border-white/10 bg-white/5 text-white/50 hover:border-white/30 hover:text-white'
  }`;

const todayLocal = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
};

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');

function describeEntry(entry: TimeOffRow): string {
  const time =
    entry.starts_at && entry.ends_at ? ` ${hhmm(entry.starts_at)}–${hhmm(entry.ends_at)}` : '';
  if (entry.kind === 'range') {
    const days =
      entry.start_date === entry.end_date
        ? entry.start_date
        : `${entry.start_date} → ${entry.end_date}`;
    return `${days}${time}`;
  }
  const days = entry.days_of_week.map((d) => DOW_LABELS[d]).join('/');
  const bounds =
    entry.start_date || entry.end_date
      ? ` (${entry.start_date ?? '…'} → ${entry.end_date ?? '…'})`
      : '';
  return `Every ${days}${time}${bounds}`;
}

export function ScheduleTimeOff() {
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showPast, setShowPast] = useState(false);

  // Form state — doubles as the edit form when editingId is set.
  const [editingId, setEditingId] = useState<string | null>(null);
  const formRef = useRef<HTMLElement>(null);
  const [staffId, setStaffId] = useState('');
  const [kind, setKind] = useState<TimeOffKind>('range');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [days, setDays] = useState<number[]>([]);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [note, setNote] = useState('');

  // Conflicts are checked over today → +6 weeks of shifts.
  const rangeStart = useMemo(todayLocal, []);
  const rangeEnd = useMemo(() => addDays(rangeStart, 42), [rangeStart]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/schedule-board?start=${rangeStart}&end=${rangeEnd}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as BoardData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [rangeStart, rangeEnd]);

  useEffect(() => {
    void load();
  }, [load]);

  const staffById = useMemo(() => new Map((data?.staff ?? []).map((s) => [s.id, s])), [data]);

  const conflicts = useMemo(() => {
    if (!data) return [];
    const assignments = data.shifts
      .filter((s) => s.status === 'active')
      .flatMap((shift) =>
        shift.assignments.map((assignment) => ({ assignment, shiftDate: shift.shift_date }))
      );
    return findAssignmentConflicts(assignments, data.timeOff);
  }, [data]);

  const { recurring, upcoming, past } = useMemo(() => {
    const entries = data?.timeOff ?? [];
    const today = todayLocal();
    return {
      recurring: entries.filter((e) => e.kind === 'recurring'),
      upcoming: entries.filter((e) => e.kind === 'range' && (e.end_date ?? '') >= today),
      past: entries.filter((e) => e.kind === 'range' && (e.end_date ?? '') < today),
    };
  }, [data]);

  const resetForm = () => {
    setEditingId(null);
    setStartDate('');
    setEndDate('');
    setDays([]);
    setStartsAt('');
    setEndsAt('');
    setNote('');
  };

  const startEditing = (entry: TimeOffRow) => {
    setEditingId(entry.id);
    setStaffId(entry.staff_id);
    setKind(entry.kind);
    setStartDate(entry.start_date ?? '');
    setEndDate(entry.end_date ?? '');
    setDays([...entry.days_of_week]);
    setStartsAt(hhmm(entry.starts_at));
    setEndsAt(hhmm(entry.ends_at));
    setNote(entry.note ?? '');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const submit = async () => {
    if (!staffId) {
      setError('Pick a person');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch('/api/admin/schedule-time-off', {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(editingId ? { id: editingId } : {}),
        staffId,
        kind,
        startDate: startDate || null,
        endDate: endDate || startDate || null,
        daysOfWeek: kind === 'recurring' ? days : [],
        startsAt: startsAt || null,
        endsAt: endsAt || null,
        note: note.trim() || null,
      }),
    });
    if (!res.ok) {
      try {
        setError(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
      } catch {
        setError(`HTTP ${res.status}`);
      }
    } else {
      resetForm();
      await load();
    }
    setBusy(false);
  };

  const remove = async (id: string) => {
    setBusy(true);
    if (id === editingId) resetForm();
    await fetch(`/api/admin/schedule-time-off?id=${id}`, { method: 'DELETE' });
    await load();
    setBusy(false);
  };

  const entryRow = (entry: TimeOffRow) => (
    <li
      key={entry.id}
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded px-3 py-2 ${
        entry.id === editingId
          ? 'bg-[var(--pyre-red)]/10 outline outline-1 outline-[var(--pyre-red)]/40'
          : 'bg-white/5'
      }`}
    >
      <span className="font-medium">{staffById.get(entry.staff_id)?.display_name ?? '?'}</span>
      <span className="font-mono text-xs text-white/60">{describeEntry(entry)}</span>
      {entry.note && <span className="font-mono text-xs text-white/40">{entry.note}</span>}
      <span className="ml-auto flex gap-3">
        <button
          type="button"
          className="font-mono text-xs text-white/50 underline hover:text-white"
          disabled={busy}
          onClick={() => startEditing(entry)}
        >
          edit
        </button>
        <button
          type="button"
          className="font-mono text-xs text-white/50 underline hover:text-[var(--pyre-red)]"
          disabled={busy}
          onClick={() => void remove(entry.id)}
        >
          remove
        </button>
      </span>
    </li>
  );

  if (loading && !data) return <p className="font-mono text-sm text-white/40">Loading…</p>;

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-red)]">
          {error}
        </p>
      )}

      {conflicts.length > 0 && (
        <section className="rounded-lg border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/5 p-3">
          <h2 className="mb-2 font-mono text-xs font-bold uppercase tracking-wide text-[var(--pyre-red)]">
            ⚠ Assignments that overlap time off (next 6 weeks)
          </h2>
          <ul className="space-y-1 text-sm">
            {conflicts.map((c) => (
              <li key={c.assignment.id} className="font-mono text-xs text-white/70">
                {c.shiftDate} — {staffById.get(c.assignment.staff_id)?.display_name ?? '?'}{' '}
                {hhmm(c.assignment.starts_at)}–{hhmm(c.assignment.ends_at)} (
                {c.conflicts.map((b) => b.note || 'time off').join('; ')})
              </li>
            ))}
          </ul>
          <p className="mt-2 font-mono text-[10px] text-white/40">
            Fix on the{' '}
            <a className="underline" href="/admin/schedule">
              schedule board
            </a>{' '}
            — nothing is unassigned automatically.
          </p>
        </section>
      )}

      <section
        ref={formRef}
        className={`space-y-2 rounded-lg border p-3 ${
          editingId
            ? 'border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/5'
            : 'border-white/10 bg-white/[0.03]'
        }`}
      >
        <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-white/50">
          {editingId
            ? `Edit time off — ${staffById.get(staffId)?.display_name ?? ''}`
            : 'Add time off'}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={inputClass}
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            aria-label="Person"
          >
            <option value="">Person…</option>
            {(data?.staff ?? [])
              .filter((s) => s.active)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name}
                </option>
              ))}
          </select>
          <button
            type="button"
            className={pillClass(kind === 'range')}
            onClick={() => setKind('range')}
          >
            Dates
          </button>
          <button
            type="button"
            className={pillClass(kind === 'recurring')}
            onClick={() => setKind('recurring')}
          >
            Weekly
          </button>
        </div>

        {kind === 'recurring' && (
          <div className="flex flex-wrap gap-1.5">
            {DOW_LABELS.map((label, i) => (
              <button
                key={label}
                type="button"
                className={pillClass(days.includes(i))}
                onClick={() =>
                  setDays(days.includes(i) ? days.filter((d) => d !== i) : [...days, i].sort())
                }
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            className={inputClass}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-label={kind === 'range' ? 'First day' : 'Starting (optional)'}
          />
          <span className="font-mono text-xs text-white/40">to</span>
          <input
            type="date"
            className={inputClass}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            aria-label={kind === 'range' ? 'Last day (blank = single day)' : 'Until (optional)'}
          />
          {kind === 'recurring' && (
            <span className="font-mono text-[10px] text-white/40">dates optional</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="time"
            step={1800}
            className={inputClass}
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            aria-label="From time (optional)"
          />
          <span className="font-mono text-xs text-white/40">to</span>
          <input
            type="time"
            step={1800}
            className={inputClass}
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            aria-label="To time (optional)"
          />
          <span className="font-mono text-[10px] text-white/40">no times = whole day</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${inputClass} flex-1`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (trip, class, …)"
            aria-label="Note"
          />
          <button
            type="button"
            className={buttonClass}
            onClick={() => void submit()}
            disabled={busy}
          >
            {editingId ? 'Save changes' : 'Add'}
          </button>
          {editingId && (
            <button type="button" className={buttonClass} onClick={resetForm} disabled={busy}>
              Cancel edit
            </button>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-mono text-xs font-bold uppercase tracking-wide text-white/50">
          Recurring
        </h2>
        {recurring.length === 0 ? (
          <p className="font-mono text-xs text-white/30">None</p>
        ) : (
          <ul className="space-y-1.5">{recurring.map(entryRow)}</ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-mono text-xs font-bold uppercase tracking-wide text-white/50">
          Upcoming
        </h2>
        {upcoming.length === 0 ? (
          <p className="font-mono text-xs text-white/30">None</p>
        ) : (
          <ul className="space-y-1.5">{upcoming.map(entryRow)}</ul>
        )}
      </section>

      <section>
        <button type="button" className={buttonClass} onClick={() => setShowPast(!showPast)}>
          {showPast ? 'Hide past' : `Past (${past.length})`}
        </button>
        {showPast && <ul className="mt-2 space-y-1.5">{past.map(entryRow)}</ul>}
      </section>
    </div>
  );
}
