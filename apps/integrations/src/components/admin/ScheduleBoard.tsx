// The weekly scheduling board: shifts per day with red/gold/green coverage
// status (the sheet's row colors), inline shift create/edit, and an
// assignment picker that shows each person's availability — computed locally
// via lib/schedule/availability from the same time-off data the API returns —
// plus their hours already scheduled that week.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ScheduleStaffRow, ShiftAssignmentRow, ShiftRow, TimeOffRow } from '@/lib/db';
import {
  type Availability,
  availabilityFor,
  minutesToTime,
  timeToMinutes,
} from '@/lib/schedule/availability';
import {
  ASSIGNMENT_ROLE_LABELS,
  ASSIGNMENT_ROLES,
  type AssignmentRole,
  DOW_LABELS,
  SHIFT_LABEL_SUGGESTIONS,
} from '@/lib/schedule/constants';
import { addDays, assignmentHours, weekStartOf } from '@/lib/schedule/hours';

interface BoardShift extends ShiftRow {
  assignments: ShiftAssignmentRow[];
}

interface BoardData {
  staff: ScheduleStaffRow[];
  shifts: BoardShift[];
  timeOff: TimeOffRow[];
}

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
  const [weekStart, setWeekStart] = useState(() => weekStartOf(todayLocal()));
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Shift form: 'new:<date>' or 'edit:<shiftId>'
  const [formTarget, setFormTarget] = useState<string | null>(null);
  const [form, setForm] = useState<ShiftFormState>(emptyShiftForm);
  const [editingAssignment, setEditingAssignment] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/schedule-board?start=${weekStart}&end=${addDays(weekStart, 6)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as BoardData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

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

  // Hours already scheduled this week per staff id (all shifts on the board).
  const weekHours = useMemo(() => {
    const hours: Record<string, number> = {};
    for (const shift of data?.shifts ?? []) {
      if (shift.status !== 'active') continue;
      for (const a of shift.assignments) {
        hours[a.staff_id] = (hours[a.staff_id] ?? 0) + assignmentHours(a.starts_at, a.ends_at);
      }
    }
    return hours;
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
        <span className="font-mono text-sm text-white/60">
          {formatDay(weekStart)} – {formatDay(addDays(weekStart, 6))}
        </span>
        {busy && <span className="font-mono text-xs text-white/40">Saving…</span>}
      </div>

      {error && (
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-red)]">
          {error}
        </p>
      )}

      <div className="space-y-4">
        {days.map((date) => {
          const shifts = shiftsByDate.get(date) ?? [];
          return (
            <section key={date} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-mono text-sm font-bold uppercase tracking-wide text-white/70">
                  {formatDay(date)}
                </h2>
                <button type="button" className={buttonClass} onClick={() => openNewShift(date)}>
                  + Shift
                </button>
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
                  const expanded = expandedId === shift.id;
                  return (
                    <div
                      key={shift.id}
                      className={`rounded border bg-white/[0.03] ${toneBorder[tone]}`}
                    >
                      <button
                        type="button"
                        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left"
                        onClick={() => setExpandedId(expanded ? null : shift.id)}
                      >
                        <span className="font-semibold">{shift.label}</span>
                        <span className="font-mono text-sm text-white/60">
                          {formatTime(shift.starts_at)}–{formatTime(shift.ends_at)}
                        </span>
                        <span className={`rounded px-2 py-0.5 font-mono text-xs ${toneChip[tone]}`}>
                          {shift.status === 'cancelled'
                            ? 'cancelled'
                            : `${shift.assignments.length}/${shift.staff_needed}`}
                        </span>
                        <span className="text-sm text-white/70">
                          {shift.assignments
                            .map((a) => staffById.get(a.staff_id)?.display_name ?? '?')
                            .join(', ')}
                        </span>
                        {shift.notes && (
                          <span className="font-mono text-xs text-white/40">{shift.notes}</span>
                        )}
                      </button>

                      {expanded && (
                        <ShiftDetail
                          shift={shift}
                          data={data as BoardData}
                          staffById={staffById}
                          weekHours={weekHours}
                          busy={busy}
                          run={run}
                          onEdit={() => openEditShift(shift)}
                          editingAssignment={editingAssignment}
                          setEditingAssignment={setEditingAssignment}
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
  onEdit,
  editingAssignment,
  setEditingAssignment,
}: {
  shift: BoardShift;
  data: BoardData;
  staffById: Map<string, ScheduleStaffRow>;
  weekHours: Record<string, number>;
  busy: boolean;
  run: (action: () => Promise<{ error?: string }>) => Promise<void>;
  onEdit: () => void;
  editingAssignment: string | null;
  setEditingAssignment: (id: string | null) => void;
}) {
  const startMin = timeToMinutes(shift.starts_at);
  const endMin = timeToMinutes(shift.ends_at);
  const assignedIds = new Set(shift.assignments.map((a) => a.staff_id));
  const candidates = data.staff.filter((s) => s.active && !assignedIds.has(s.id));

  return (
    <div className="space-y-3 border-t border-white/10 px-3 py-3">
      {shift.assignments.length > 0 && (
        <ul className="space-y-1.5">
          {shift.assignments.map((a) => {
            const person = staffById.get(a.staff_id);
            const availability = availabilityFor(
              data.timeOff,
              a.staff_id,
              shift.shift_date,
              timeToMinutes(a.starts_at),
              timeToMinutes(a.ends_at)
            );
            const editing = editingAssignment === a.id;
            return (
              <li key={a.id} className="rounded bg-white/5 px-2 py-1.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{person?.display_name ?? '?'}</span>
                  <span className="font-mono text-xs text-white/60">
                    {formatTime(a.starts_at)}–{formatTime(a.ends_at)} ·{' '}
                    {assignmentHours(a.starts_at, a.ends_at)}h · {ASSIGNMENT_ROLE_LABELS[a.role]}
                  </span>
                  {availability.status !== 'free' && (
                    <span className="font-mono text-xs text-[var(--pyre-red)]">
                      ⚠ time off:{' '}
                      {availability.conflicts.map((c) => c.note || 'unavailable').join('; ')}
                    </span>
                  )}
                  {a.notes && <span className="font-mono text-xs text-white/40">{a.notes}</span>}
                  <span className="ml-auto flex gap-2">
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
                  </span>
                </div>
                {editing && (
                  <AssignmentEditor
                    assignment={a}
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

      {candidates.length > 0 && shift.status === 'active' && (
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

      <button type="button" className={buttonClass} onClick={onEdit}>
        Edit shift
      </button>
    </div>
  );
}

function AssignmentEditor({
  assignment,
  busy,
  onSave,
}: {
  assignment: ShiftAssignmentRow;
  busy: boolean;
  onSave: (fields: { startsAt: string; endsAt: string; role: AssignmentRole }) => Promise<void>;
}) {
  const [startsAt, setStartsAt] = useState(hhmm(assignment.starts_at));
  const [endsAt, setEndsAt] = useState(hhmm(assignment.ends_at));
  const [role, setRole] = useState<AssignmentRole>(assignment.role);

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
        <button key={r} type="button" className={pillClass(role === r)} onClick={() => setRole(r)}>
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
