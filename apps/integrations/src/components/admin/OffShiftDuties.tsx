// One day's off-shift duties on the schedule board: the jobs done that day
// whether or not anyone works a shift (fill the carboys Monday, weigh the
// propane Sunday), each with the one person it's handed to.
//
// A schedule manager picks the person from the people who can do it — active,
// and trained on it when the duty requires training — or takes them off. The
// person it's assigned to (or a manager) ticks it done. A row someone already
// holds stays visible even after the duty is retired or its days change, so
// nothing assigned silently disappears. A day the scheduler agent drafted
// shows dashed with accept / reject, like its draft shift assignments;
// picking someone in the select takes it live too.

import {
  type DutyAssignmentRow,
  type DutyCatalog,
  type DutyTraining,
  dutyDef,
  isTrainedFor,
  type OffShiftOccurrence,
} from '@pyre/schedule-core';
import type { StaffRow } from '@/lib/db';

const chipClass =
  'rounded border border-[var(--pyre-sage)]/40 bg-[var(--pyre-sage)]/10 px-1.5 py-0.5 font-mono text-[10px] text-[var(--pyre-sage)]';

const selectClass =
  'rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-[var(--pyre-creme)] focus:outline-none focus:border-white/30';

export function OffShiftDuties({
  date,
  occurrences,
  assignments,
  catalog,
  training,
  staff,
  selfId,
  canManage,
  canViewSops,
  busy,
  onAssign,
  onUnassign,
  onDone,
  onDraft,
}: {
  date: string;
  /** The off-shift duties done on `date` (offShiftOccurrences). */
  occurrences: OffShiftOccurrence[];
  /** duty_assignments rows on `date`. */
  assignments: DutyAssignmentRow[];
  catalog: DutyCatalog;
  training: DutyTraining;
  staff: StaffRow[];
  selfId: string | null;
  canManage: boolean;
  canViewSops: boolean;
  busy: boolean;
  onAssign: (dutyKey: string, staffId: string) => void;
  onUnassign: (id: string) => void;
  onDone: (id: string, done: boolean) => void;
  /** Accept (true) or reject an agent-drafted day. */
  onDraft: (id: string, accept: boolean) => void;
}) {
  const byKey = new Map(assignments.map((a) => [a.duty_key, a]));
  // Every duty done today, then any assigned one that no longer is.
  const keys = [
    ...occurrences.map((o) => o.duty.key),
    ...assignments.map((a) => a.duty_key).filter((k) => !occurrences.some((o) => o.duty.key === k)),
  ];
  if (keys.length === 0) return null;

  const nameOf = (id: string) => staff.find((s) => s.id === id)?.display_name ?? 'Someone';

  return (
    <div className="mt-2 rounded border border-white/10 bg-white/[0.02] px-2 py-1.5">
      <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-white/40">
        Off-shift duties
      </p>
      <ul className="space-y-1">
        {keys.map((key) => {
          const def = dutyDef(catalog, key);
          const label = def?.label ?? key;
          const row = byKey.get(key);
          const draft = !!row?.is_draft;
          const mine = !!row && row.staff_id === selfId;
          const canTick = !!row && !draft && (canManage || mine);
          // Who can take it: active, and trained when it requires training.
          // Whoever has it now stays listed so the select shows them.
          const candidates = staff.filter(
            (s) =>
              s.id === row?.staff_id || (s.active && isTrainedFor(catalog, training, s.id, key))
          );
          return (
            <li
              key={key}
              className={`flex flex-wrap items-center gap-2 text-xs ${
                draft ? 'rounded border border-dashed border-[var(--pyre-gold)]/50 px-1 py-0.5' : ''
              }`}
            >
              {canViewSops && def?.sopSlug ? (
                <a
                  className={`${chipClass} underline decoration-[var(--pyre-sage)]/40 hover:text-[var(--pyre-creme)]`}
                  href={`/admin/sops/${def.sopSlug}`}
                  title={def.detail ? `${label} — ${def.detail}` : label}
                >
                  {label}
                </a>
              ) : (
                <span className={chipClass} title={def?.detail ?? undefined}>
                  {label}
                </span>
              )}
              {canManage ? (
                <select
                  className={selectClass}
                  aria-label={`Who does ${label} on ${date}`}
                  disabled={busy}
                  value={row?.staff_id ?? ''}
                  onChange={(e) => {
                    if (e.target.value) onAssign(key, e.target.value);
                    else if (row) onUnassign(row.id);
                  }}
                >
                  <option value="">
                    {candidates.length === 0 ? 'Nobody trained' : 'Unassigned'}
                  </option>
                  {candidates.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.display_name}
                    </option>
                  ))}
                </select>
              ) : (
                <span
                  className={
                    row
                      ? mine
                        ? 'font-primary-semibold text-[var(--pyre-gold)]'
                        : 'text-[var(--pyre-creme)]'
                      : 'text-white/35'
                  }
                >
                  {row ? (mine ? 'You' : nameOf(row.staff_id)) : 'Unassigned'}
                </span>
              )}
              {canManage && !row && (
                <span className="font-mono text-[10px] text-[var(--pyre-gold)]">needs someone</span>
              )}
              {draft && row && canManage && (
                <span className="flex items-center gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)]">
                    Draft
                  </span>
                  <button
                    type="button"
                    className="rounded border border-white/10 bg-white/5 px-1.5 text-white/70 hover:text-white"
                    title="Accept this draft"
                    disabled={busy}
                    onClick={() => onDraft(row.id, true)}
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    className="rounded border border-white/10 bg-white/5 px-1.5 text-[var(--pyre-red)]"
                    title="Reject this draft"
                    disabled={busy}
                    onClick={() => onDraft(row.id, false)}
                  >
                    ✗
                  </button>
                </span>
              )}
              {row && !draft && (
                <label
                  className={`flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide ${
                    row.done_at ? 'text-[var(--pyre-sage)]' : 'text-white/40'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={!!row.done_at}
                    disabled={busy || !canTick}
                    onChange={(e) => onDone(row.id, e.target.checked)}
                  />
                  Done
                </label>
              )}
              {def && (def.archived || !occurrences.some((o) => o.duty.key === key)) && (
                <span
                  className="font-mono text-[10px] text-[var(--pyre-gold)]"
                  title="The duty list no longer has this done on this day"
                >
                  ⚠ {def.archived ? 'retired' : 'not done this day'}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
