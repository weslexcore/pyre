// The duty list (/admin/schedule/duties): which jobs — and so which SOPs —
// the schedule board offers when assigning someone to a shift.
//
// Duties are grouped by the phase of the shift they belong to. Each can be
// renamed, re-described, re-linked to a different SOP, moved between phases,
// given an A/B side (set-up and break-down only) with the in-session duty
// that side usually takes, nudged up or down, and retired. Keys are
// permanent — every assignment stores them — so a duty someone already holds
// is retired rather than deleted, and stays readable on those shifts.

import {
  DUTY_PHASE_KEYS,
  DUTY_PHASE_LABELS,
  type DutyDef,
  type DutyPhaseKey,
  type DutySide,
  dutyPhases,
} from '@pyre/schedule-core';
import { useMemo, useState } from 'react';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import { ConfirmDialog } from './ConfirmDialog';
import { QuietBadge, send } from './guestUi';
import {
  buttonClass,
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  SectionTitle,
} from './incidentUi';

const ENDPOINT = '/api/admin/shift-duties';

type DutyView = DutyDef & { sopId: string | null };

interface SopOption {
  id: string;
  slug: string;
  title: string;
  category: string | null;
}

interface DutiesResponse {
  duties: DutyView[];
  uses: Record<string, number>;
  sops: SopOption[];
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
}

const BLANK_FORM: DutyForm = {
  label: '',
  detail: '',
  phase: 'session',
  side: '',
  sessionDefault: '',
  sopId: '',
};

function formFor(duty: DutyView): DutyForm {
  return {
    label: duty.label,
    detail: duty.detail ?? '',
    phase: duty.phase,
    side: duty.side ?? '',
    sessionDefault: duty.sessionDefault ?? '',
    sopId: duty.sopId ?? '',
  };
}

/** The API body for a form: half-only settings are cleared for session duties. */
function bodyFor(form: DutyForm): Record<string, unknown> {
  const isHalf = form.phase !== 'session';
  return {
    label: form.label,
    detail: form.detail,
    phase: form.phase,
    side: isHalf && form.side ? form.side : null,
    sessionDefault: isHalf && form.sessionDefault ? form.sessionDefault : null,
    sopId: form.sopId || null,
  };
}

export function ShiftDutiesManager() {
  const { data, error, loading, reload } = useCachedJson<DutiesResponse>(ENDPOINT);
  const duties = useMemo(() => data?.duties ?? [], [data]);
  const uses = data?.uses ?? {};
  const sops = data?.sops ?? [];
  const canManage = data?.canManage ?? false;

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
    mutate(key, () => send(ENDPOINT, 'PATCH', { key, ...body }));

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
      send(ENDPOINT, 'PATCH', { order: [...order, ...archived.map((d) => d.key)] })
    );
  };

  const saveEdit = async (duty: DutyView) => {
    if (!form) return;
    // Only send what changed, so an untouched side can't trip the one-per-side rule.
    const next = bodyFor(form);
    const prev = bodyFor(formFor(duty));
    const changes = Object.fromEntries(
      Object.entries(next).filter(([k, v]) => (prev as Record<string, unknown>)[k] !== v)
    );
    if (Object.keys(changes).length === 0) {
      setEditing(null);
      setForm(null);
      return;
    }
    if (await patch(duty.key, changes)) {
      setEditing(null);
      setForm(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    const key = deleting.key;
    const ok = await mutate(key, () =>
      send(`${ENDPOINT}?key=${encodeURIComponent(key)}`, 'DELETE')
    );
    if (ok) setDeleting(null);
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
              {canManage && (
                <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-white/30">
                  {duty.key} · {count} assignment{count === 1 ? '' : 's'}
                </p>
              )}
            </div>
            {canManage && (
              <div className="flex flex-wrap gap-1.5">
                {!duty.archived && (
                  <>
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={busy !== null || position <= 0}
                      aria-label={`Move ${duty.label} up`}
                      onClick={() => nudge(duty.key, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={buttonClass}
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
                  className={buttonClass}
                  disabled={busy !== null}
                  onClick={() => {
                    setEditing(duty.key);
                    setForm(formFor(duty));
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy !== null}
                  onClick={() => void patch(duty.key, { archived: !duty.archived })}
                >
                  {duty.archived ? 'Restore' : 'Retire'}
                </button>
                {count === 0 && (
                  <button
                    type="button"
                    className={buttonClass}
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
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={primaryButtonClass}
                disabled={busy !== null || !form.label.trim()}
                onClick={() => void saveEdit(duty)}
              >
                {busy === duty.key ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className={buttonClass}
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
          busy={busy !== null}
          onAdd={(body) => mutate('new', () => send(ENDPOINT, 'POST', body))}
        />
      )}

      {message && <p className="text-sm text-[var(--pyre-red)]">{message}</p>}
      {error && <p className="text-sm text-[var(--pyre-red)]">Couldn't load duties: {error}</p>}
      {loading && !data && <p className="font-mono text-xs text-white/40">Loading…</p>}

      {phases.map((phase) => (
        <section key={phase.key} className={cardClass}>
          <SectionTitle>{phase.label}</SectionTitle>
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

/** Label, detail, phase, side, in-session default and SOP — shared by add and edit. */
function DutyFields({
  idPrefix,
  form,
  onChange,
  sops,
  sessionDuties,
}: {
  idPrefix: string;
  form: DutyForm;
  onChange: (form: DutyForm) => void;
  sops: SopOption[];
  sessionDuties: DutyDef[];
}) {
  const isHalf = form.phase !== 'session';
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
          Part of the shift
        </label>
        <select
          id={`${idPrefix}-phase`}
          className={inputClass}
          value={form.phase}
          onChange={(e) => onChange({ ...form, phase: e.target.value as DutyPhaseKey })}
        >
          {DUTY_PHASE_KEYS.map((key) => (
            <option key={key} value={key}>
              {DUTY_PHASE_LABELS[key]}
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
  busy,
  onAdd,
}: {
  sops: SopOption[];
  sessionDuties: DutyDef[];
  busy: boolean;
  onAdd: (body: Record<string, unknown>) => Promise<boolean>;
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
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={primaryButtonClass}
            disabled={busy || !form.label.trim()}
            onClick={async () => {
              if (await onAdd(bodyFor(form))) {
                setForm(BLANK_FORM);
                setOpen(false);
              }
            }}
          >
            {busy ? 'Adding…' : 'Add duty'}
          </button>
          <button
            type="button"
            className={buttonClass}
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
