// The duty list (/admin/schedule/duties): which jobs — and so which SOPs —
// the schedule board offers when assigning someone to a shift.
//
// Duties are grouped by the phase of the shift they belong to. Each can be
// renamed, re-described, re-linked to a different SOP, moved between phases,
// given an A/B side (set-up and break-down only) with the in-session duty
// that side usually takes, limited to days of the week (water the plants
// Friday to Sunday), nudged up or down, and retired. Keys are
// permanent — every assignment stores them — so a duty someone already holds
// is retired rather than deleted, and stays readable on those shifts.
//
// Off-shift duties (fill the carboys every Monday) sit in their own group:
// they're done on their days whether or not anyone works a shift, and each
// day is handed to one person on the schedule board.
//
// Every duty says who can do it: Anyone, or the people picked for it (stored
// as requires_training plus staff_duty_training). Saving a duty needs one or
// the other, so a new duty never lands without that choice made.

import {
  DOW_LABELS,
  DUTY_PHASE_KEYS,
  DUTY_PHASE_LABELS,
  type DutyDef,
  type DutyPhaseKey,
  type DutySide,
  dutyPhases,
  formatDutyDays,
  normalizeDutyDays,
} from '@pyre/schedule-core';
import { useMemo, useState } from 'react';
import { formButtonClass } from '@/components/admin/ui';
import { sendJson } from '@/lib/client/api';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import { ConfirmDialog } from './ConfirmDialog';
import { QuietBadge } from './guestUi';
import { cardClass, inputClass, labelClass, primaryButtonClass, SectionTitle } from './incidentUi';

const ENDPOINT = '/api/admin/shift-duties';
const TRAINING_ENDPOINT = '/api/admin/duty-training';

type DutyView = DutyDef & { sopId: string | null };

interface SopOption {
  id: string;
  slug: string;
  title: string;
  category: string | null;
}

interface StaffOption {
  id: string;
  display_name: string;
  active: boolean;
}

interface DutiesResponse {
  duties: DutyView[];
  training: Array<{ staffId: string; dutyKey: string }>;
  uses: Record<string, number>;
  sops: SopOption[];
  staff: StaffOption[];
  canManage: boolean;
}

/** The form behind both "add" and "edit". */
interface DutyForm {
  label: string;
  detail: string;
  phase: DutyPhaseKey;
  side: DutySide | '';
  sessionDefault: string;
  sopId: string;
  /** Days of the week it's done (0 = Sunday); all seven for every day. */
  days: number[];
  /** Anyone can do it; null until chosen on a new duty. */
  anyone: boolean | null;
  /** Who can do it when not anyone. */
  staffIds: string[];
}

/** The "who can do it" choice is made: Anyone, or at least one person. */
const whoChosen = (form: DutyForm) => form.anyone === true || form.staffIds.length > 0;

const sameIds = (a: readonly string[], b: readonly string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** Set-up and break-down: the phases a duty can have an A/B side in. */
const isHalfPhase = (phase: DutyPhaseKey) => phase === 'setup' || phase === 'breakdown';

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/** The day picker's order: Monday first, the weekend together. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const BLANK_FORM: DutyForm = {
  label: '',
  detail: '',
  phase: 'session',
  side: '',
  sessionDefault: '',
  sopId: '',
  days: EVERY_DAY,
  anyone: null,
  staffIds: [],
};

function formFor(duty: DutyView, trained: string[]): DutyForm {
  return {
    label: duty.label,
    detail: duty.detail ?? '',
    phase: duty.phase,
    side: duty.side ?? '',
    sessionDefault: duty.sessionDefault ?? '',
    sopId: duty.sopId ?? '',
    days: duty.days ?? EVERY_DAY,
    anyone: !duty.requiresTraining,
    staffIds: trained,
  };
}

/** The API body for a form: half-only settings are cleared outside set-up / break-down. */
function bodyFor(form: DutyForm): Record<string, unknown> {
  const isHalf = isHalfPhase(form.phase);
  return {
    label: form.label,
    detail: form.detail,
    phase: form.phase,
    side: isHalf && form.side ? form.side : null,
    sessionDefault: isHalf && form.sessionDefault ? form.sessionDefault : null,
    sopId: form.sopId || null,
    days: normalizeDutyDays(form.days),
    requiresTraining: form.anyone !== true,
  };
}

export function ShiftDutiesManager() {
  const { data, error, loading, reload } = useCachedJson<DutiesResponse>(ENDPOINT);
  const duties = useMemo(() => data?.duties ?? [], [data]);
  const uses = data?.uses ?? {};
  const sops = data?.sops ?? [];
  const staff = useMemo(() => data?.staff ?? [], [data]);
  const canManage = data?.canManage ?? false;
  // Duty key -> the staff trained on it.
  const trainedBy = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const t of data?.training ?? []) {
      map.set(t.dutyKey, [...(map.get(t.dutyKey) ?? []), t.staffId]);
    }
    return map;
  }, [data]);
  const nameOf = (id: string) => staff.find((p) => p.id === id)?.display_name ?? 'Someone';
  const trainedOf = (key: string) => trainedBy.get(key) ?? [];

  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<DutyForm | null>(null);
  const [deleting, setDeleting] = useState<DutyView | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const phases = useMemo(() => dutyPhases(duties), [duties]);
  const archived = useMemo(() => duties.filter((d) => d.archived), [duties]);
  const sessionDuties = useMemo(
    () => duties.filter((d) => d.phase === 'session' && !d.archived),
    [duties]
  );
  const sopTitle = (id: string | null) => sops.find((s) => s.id === id)?.title;

  /** Run a mutation, then refetch the list here and on the board. */
  const mutate = async (tag: string, run: () => Promise<unknown>): Promise<boolean> => {
    setBusy(tag);
    setMessage(null);
    try {
      await run();
      invalidateJson(ENDPOINT);
      await reload();
      return true;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const patch = (key: string, body: Record<string, unknown>) =>
    mutate(key, () => sendJson(ENDPOINT, 'PATCH', { key, ...body }));

  /** Swap `key` with its neighbour inside its phase, then send the full order. */
  const nudge = (key: string, direction: -1 | 1) => {
    const phase = phases.find((p) => p.duties.some((d) => d.key === key));
    if (!phase) return;
    const within = phase.duties.map((d) => d.key);
    const index = within.indexOf(key);
    const other = within[index + direction];
    if (!other) return;
    const order = phases.flatMap((p) => p.duties.map((d) => d.key));
    const a = order.indexOf(key);
    const b = order.indexOf(other);
    [order[a], order[b]] = [order[b], order[a]];
    void mutate(key, () =>
      sendJson(ENDPOINT, 'PATCH', { order: [...order, ...archived.map((d) => d.key)] })
    );
  };

  const saveEdit = async (duty: DutyView) => {
    if (!form) return;
    // Only send what changed, so an untouched side can't trip the one-per-side rule.
    const next = bodyFor(form);
    const prev = bodyFor(formFor(duty, trainedOf(duty.key)));
    const changes = Object.fromEntries(
      Object.entries(next).filter(
        ([k, v]) => JSON.stringify((prev as Record<string, unknown>)[k]) !== JSON.stringify(v)
      )
    );
    // The people go in first, so the duty is never restricted to nobody.
    const peopleChanged = form.anyone !== true && !sameIds(form.staffIds, trainedOf(duty.key));
    if (Object.keys(changes).length === 0 && !peopleChanged) {
      setEditing(null);
      setForm(null);
      return;
    }
    const ok = await mutate(duty.key, async () => {
      if (peopleChanged) {
        await sendJson(TRAINING_ENDPOINT, 'PUT', { key: duty.key, staffIds: form.staffIds });
      }
      if (Object.keys(changes).length > 0) {
        await sendJson(ENDPOINT, 'PATCH', { key: duty.key, ...changes });
      }
    });
    if (ok) {
      setEditing(null);
      setForm(null);
    }
  };

  /** Add a duty, then who can do it (the key comes back from the add). */
  const addDuty = (form: DutyForm) =>
    mutate('new', async () => {
      const { key } = await sendJson<{ key: string }>(ENDPOINT, 'POST', bodyFor(form));
      if (form.anyone !== true) {
        await sendJson(TRAINING_ENDPOINT, 'PUT', { key, staffIds: form.staffIds });
      }
    });

  const remove = async () => {
    if (!deleting) return;
    const key = deleting.key;
    const ok = await mutate(key, () =>
      sendJson(`${ENDPOINT}?key=${encodeURIComponent(key)}`, 'DELETE')
    );
    if (ok) setDeleting(null);
  };

  /** "Anyone", or the people who can do it. */
  const renderWho = (duty: DutyView) => {
    const people = trainedOf(duty.key).map(nameOf).sort();
    return (
      <p className="mt-1 text-xs text-white/55">
        {!duty.requiresTraining ? (
          <span className="text-white/40">Anyone can do it</span>
        ) : people.length > 0 ? (
          <>Can do it: {people.join(', ')}</>
        ) : (
          <span className="text-[var(--pyre-red)]">
            Nobody is picked to do this yet, so it can't be assigned. Edit it to pick people.
          </span>
        )}
      </p>
    );
  };

  const renderDuty = (duty: DutyView) => {
    const isEditing = editing === duty.key && form;
    const count = uses[duty.key] ?? 0;
    const siblings = phases.find((p) => p.key === duty.phase)?.duties ?? [];
    const position = siblings.findIndex((d) => d.key === duty.key);
    const defaultLabel = duties.find((d) => d.key === duty.sessionDefault)?.label;

    return (
      <li key={duty.key} className="py-3 first:pt-0 last:pb-0">
        {!isEditing ? (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-primary-semibold text-[var(--pyre-creme)]">
                  {duty.label}
                </span>
                {duty.side && <QuietBadge>Side {duty.side.toUpperCase()}</QuietBadge>}
                {(duty.days || duty.phase === 'off_shift') && (
                  <QuietBadge>{formatDutyDays(duty.days)}</QuietBadge>
                )}
                {duty.archived && <QuietBadge>Retired</QuietBadge>}
              </div>
              {duty.detail && <p className="mt-0.5 text-xs text-white/45">{duty.detail}</p>}
              <p className="mt-1 text-xs text-white/55">
                {duty.sopSlug ? (
                  <a
                    className="underline decoration-white/20 hover:text-white"
                    href={`/admin/sops/${duty.sopSlug}`}
                  >
                    {sopTitle(duty.sopId) ?? duty.sopSlug}
                  </a>
                ) : (
                  <span className="text-white/35">No SOP linked</span>
                )}
                {defaultLabel && (
                  <span className="text-white/40"> · usually with {defaultLabel}</span>
                )}
              </p>
              {renderWho(duty)}
              {canManage && (
                <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-white/30">
                  {duty.key} · {count} {duty.phase === 'off_shift' ? 'day' : 'assignment'}
                  {count === 1 ? '' : 's'}
                </p>
              )}
            </div>
            {canManage && (
              <div className="flex flex-wrap gap-1.5">
                {!duty.archived && (
                  <>
                    <button
                      type="button"
                      className={formButtonClass}
                      disabled={busy !== null || position <= 0}
                      aria-label={`Move ${duty.label} up`}
                      onClick={() => nudge(duty.key, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={formButtonClass}
                      disabled={busy !== null || position < 0 || position >= siblings.length - 1}
                      aria-label={`Move ${duty.label} down`}
                      onClick={() => nudge(duty.key, 1)}
                    >
                      ↓
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className={formButtonClass}
                  disabled={busy !== null}
                  onClick={() => {
                    setEditing(duty.key);
                    setForm(formFor(duty, trainedOf(duty.key)));
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={formButtonClass}
                  disabled={busy !== null}
                  onClick={() => void patch(duty.key, { archived: !duty.archived })}
                >
                  {duty.archived ? 'Restore' : 'Retire'}
                </button>
                {count === 0 && (
                  <button
                    type="button"
                    className={formButtonClass}
                    disabled={busy !== null}
                    onClick={() => setDeleting(duty)}
                  >
                    Delete
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3 rounded border border-white/10 bg-white/[0.02] p-3">
            <DutyFields
              idPrefix={`edit-${duty.key}`}
              form={form}
              onChange={setForm}
              sops={sops}
              sessionDuties={sessionDuties.filter((d) => d.key !== duty.key)}
              staff={staff}
            />
            {(form.phase === 'off_shift') !== (duty.phase === 'off_shift') && count > 0 && (
              <p className="text-xs text-[var(--pyre-gold)]">
                {form.phase === 'off_shift'
                  ? `Shifts that already have ${duty.label} keep it, flagged on the board — take it off them there. From now on it's handed out by the day instead.`
                  : `Days already handed out for ${duty.label} stay on the board, flagged. From now on it's assigned on shifts instead.`}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={primaryButtonClass}
                disabled={
                  busy !== null || !form.label.trim() || form.days.length === 0 || !whoChosen(form)
                }
                onClick={() => void saveEdit(duty)}
              >
                {busy === duty.key ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className={formButtonClass}
                disabled={busy !== null}
                onClick={() => {
                  setEditing(null);
                  setForm(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-6">
      {canManage && (
        <AddDutyForm
          sops={sops}
          sessionDuties={sessionDuties}
          staff={staff}
          busy={busy !== null}
          onAdd={addDuty}
        />
      )}

      {message && <p className="text-sm text-[var(--pyre-red)]">{message}</p>}
      {error && <p className="text-sm text-[var(--pyre-red)]">Couldn't load duties: {error}</p>}
      {loading && !data && <p className="font-mono text-xs text-white/40">Loading…</p>}

      {phases.map((phase) => (
        <section key={phase.key} className={cardClass}>
          <SectionTitle
            note={
              phase.key === 'off_shift'
                ? 'Done on their days whether or not anyone works a shift. Each day is handed to one person on the schedule board.'
                : undefined
            }
          >
            {phase.label}
          </SectionTitle>
          <ul className="divide-y divide-white/5">
            {phase.duties.map((d) => renderDuty(d as DutyView))}
          </ul>
        </section>
      ))}

      {data && phases.length === 0 && (
        <div className={cardClass}>
          <p className="text-sm text-white/60">
            No active duties — the schedule board has nothing to assign.
            {canManage ? ' Add the first one above.' : ''}
          </p>
        </div>
      )}

      {archived.length > 0 && (
        <section className={cardClass}>
          <button
            type="button"
            className="flex w-full items-center justify-between text-left"
            aria-expanded={showArchived}
            onClick={() => setShowArchived((v) => !v)}
          >
            <span className="text-base font-primary-semibold text-[var(--pyre-creme)]">
              Retired duties ({archived.length})
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wide text-white/35">
              {showArchived ? 'Hide' : 'Show'}
            </span>
          </button>
          {showArchived && (
            <ul className="mt-4 divide-y divide-white/5">{archived.map(renderDuty)}</ul>
          )}
        </section>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.label}"?`}
          body="Nobody has been assigned this duty, so nothing is lost — but it is gone for good. Retire it instead if you might want it back."
          confirmLabel="Delete"
          danger
          busy={busy !== null}
          onConfirm={() => void remove()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

/**
 * Label, detail, phase, side, in-session default, SOP, days and training —
 * shared by add and edit.
 */
function DutyFields({
  idPrefix,
  form,
  onChange,
  sops,
  sessionDuties,
  staff,
  phases = DUTY_PHASE_KEYS,
}: {
  idPrefix: string;
  form: DutyForm;
  onChange: (form: DutyForm) => void;
  sops: SopOption[];
  sessionDuties: DutyDef[];
  /** The roster to pick who can do it from. */
  staff: StaffOption[];
  /** The phases it may be put in; all of them for a new duty. */
  phases?: readonly DutyPhaseKey[];
}) {
  const isHalf = isHalfPhase(form.phase);
  const offShift = form.phase === 'off_shift';
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className={labelClass} htmlFor={`${idPrefix}-label`}>
          Label
        </label>
        <input
          id={`${idPrefix}-label`}
          className={inputClass}
          maxLength={40}
          value={form.label}
          placeholder="Opening Checks"
          onChange={(e) => onChange({ ...form, label: e.target.value })}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor={`${idPrefix}-detail`}>
          What it covers (optional)
        </label>
        <input
          id={`${idPrefix}-detail`}
          className={inputClass}
          maxLength={60}
          value={form.detail}
          placeholder="Fire + Water"
          onChange={(e) => onChange({ ...form, detail: e.target.value })}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor={`${idPrefix}-phase`}>
          When it's done
        </label>
        <select
          id={`${idPrefix}-phase`}
          className={inputClass}
          value={form.phase}
          disabled={phases.length < 2}
          onChange={(e) => onChange({ ...form, phase: e.target.value as DutyPhaseKey })}
        >
          {phases.map((key) => (
            <option key={key} value={key}>
              {key === 'off_shift' ? 'Off shift (its own day)' : DUTY_PHASE_LABELS[key]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass} htmlFor={`${idPrefix}-sop`}>
          SOP
        </label>
        <select
          id={`${idPrefix}-sop`}
          className={inputClass}
          value={form.sopId}
          onChange={(e) => onChange({ ...form, sopId: e.target.value })}
        >
          <option value="">No SOP</option>
          {sops.map((sop) => (
            <option key={sop.id} value={sop.id}>
              {sop.title}
              {sop.category ? ` (${sop.category})` : ''}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="sm:col-span-2">
        <legend className={labelClass}>Days</legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEK_ORDER.map((day) => {
            const on = form.days.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                className={`rounded border px-2.5 py-1.5 font-mono text-xs uppercase tracking-wide transition-colors ${
                  on
                    ? 'border-[var(--pyre-sage)] bg-[var(--pyre-sage)]/20 text-[var(--pyre-creme)]'
                    : 'border-white/10 bg-white/5 text-white/50 hover:text-white'
                }`}
                onClick={() =>
                  onChange({
                    ...form,
                    days: on ? form.days.filter((d) => d !== day) : [...form.days, day],
                  })
                }
              >
                {DOW_LABELS[day]}
              </button>
            );
          })}
          {form.days.length < 7 && (
            <button
              type="button"
              className="px-1 font-mono text-[10px] uppercase tracking-wide text-white/40 underline hover:text-white"
              onClick={() => onChange({ ...form, days: EVERY_DAY })}
            >
              Every day
            </button>
          )}
        </div>
        <p
          className={`mt-1 text-xs ${form.days.length === 0 ? 'text-[var(--pyre-red)]' : 'text-white/40'}`}
        >
          {form.days.length === 0
            ? 'Pick at least one day.'
            : offShift
              ? `Someone is needed for it ${form.days.length === 7 ? 'every day' : formatDutyDays(form.days)}, assigned on the schedule board.`
              : form.days.length === 7
                ? 'Done every shift.'
                : `Only offered on shifts ${formatDutyDays(form.days)}. A job done at set-up one day and break down another is two duties.`}
        </p>
      </fieldset>
      <fieldset className="sm:col-span-2">
        <legend className={labelClass}>Who can do it</legend>
        <label className="mb-2 flex items-center gap-2 text-sm text-[var(--pyre-creme)]">
          <input
            type="checkbox"
            checked={form.anyone === true}
            onChange={(e) => onChange({ ...form, anyone: e.target.checked })}
          />
          Anyone
        </label>
        {form.anyone !== true && (
          <div className="flex flex-wrap gap-1.5">
            {/* Off-roster people stay listed only while they're still picked. */}
            {staff
              .filter((p) => p.active || form.staffIds.includes(p.id))
              .map((p) => {
                const on = form.staffIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    className={`rounded border px-2.5 py-1.5 text-xs transition-colors ${
                      on
                        ? 'border-[var(--pyre-sage)] bg-[var(--pyre-sage)]/20 text-[var(--pyre-creme)]'
                        : 'border-white/10 bg-white/5 text-white/50 hover:text-white'
                    }`}
                    onClick={() =>
                      onChange({
                        ...form,
                        anyone: false,
                        staffIds: on
                          ? form.staffIds.filter((id) => id !== p.id)
                          : [...form.staffIds, p.id],
                      })
                    }
                  >
                    {p.display_name}
                  </button>
                );
              })}
          </div>
        )}
        <p
          className={`mt-1 text-xs ${whoChosen(form) ? 'text-white/40' : 'text-[var(--pyre-red)]'}`}
        >
          {form.anyone === true
            ? 'Anyone on the roster can be given it.'
            : whoChosen(form)
              ? 'Only the people picked can be given it — on the board, by the scheduling agent, or when taking a sub.'
              : 'Tick Anyone, or pick the people who can do it.'}
        </p>
      </fieldset>
      {isHalf && (
        <>
          <div>
            <label className={labelClass} htmlFor={`${idPrefix}-side`}>
              A/B side
            </label>
            <select
              id={`${idPrefix}-side`}
              className={inputClass}
              value={form.side}
              onChange={(e) => onChange({ ...form, side: e.target.value as DutySide | '' })}
            >
              <option value="">Not split</option>
              <option value="a">A</option>
              <option value="b">B</option>
            </select>
            <p className="mt-1 text-xs text-white/40">
              Whoever takes a side at set-up is paired with the same side at break down.
            </p>
          </div>
          <div>
            <label className={labelClass} htmlFor={`${idPrefix}-default`}>
              Usually paired with
            </label>
            <select
              id={`${idPrefix}-default`}
              className={inputClass}
              value={form.sessionDefault}
              onChange={(e) => onChange({ ...form, sessionDefault: e.target.value })}
            >
              <option value="">Nothing</option>
              {sessionDuties.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-white/40">
              The in-session duty the board adds when someone takes this one.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function AddDutyForm({
  sops,
  sessionDuties,
  staff,
  busy,
  onAdd,
}: {
  sops: SopOption[];
  sessionDuties: DutyDef[];
  staff: StaffOption[];
  busy: boolean;
  onAdd: (form: DutyForm) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<DutyForm>(BLANK_FORM);

  if (!open) {
    return (
      <button type="button" className={primaryButtonClass} onClick={() => setOpen(true)}>
        Add a duty
      </button>
    );
  }

  return (
    <section className={cardClass}>
      <SectionTitle note="It appears in the schedule board's duty picker straight away.">
        New duty
      </SectionTitle>
      <div className="space-y-3">
        <DutyFields
          idPrefix="new-duty"
          form={form}
          onChange={setForm}
          sops={sops}
          sessionDuties={sessionDuties}
          staff={staff}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={primaryButtonClass}
            disabled={busy || !form.label.trim() || form.days.length === 0 || !whoChosen(form)}
            onClick={async () => {
              if (await onAdd(form)) {
                setForm(BLANK_FORM);
                setOpen(false);
              }
            }}
          >
            {busy ? 'Adding…' : 'Add duty'}
          </button>
          <button
            type="button"
            className={formButtonClass}
            disabled={busy}
            onClick={() => {
              setForm(BLANK_FORM);
              setOpen(false);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}
