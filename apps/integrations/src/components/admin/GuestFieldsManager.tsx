// The question list (/admin/guests/fields), for people with guests:manage.
//
// Fields are grouped by section in the order they appear on a profile. Each
// can be renamed, given new options, moved between sections, flagged for the
// roster, nudged up or down, and retired. Keys and kinds are permanent —
// answers hang off them — so the form never offers to change either;
// retiring and adding is the honest edit.

import { useMemo, useState } from 'react';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import type { GuestProfileFieldRow } from '@/lib/db';
import {
  DEFAULT_SECTION,
  FIELD_KIND_HINTS,
  FIELD_KIND_LABELS,
  FIELD_KINDS,
  FIELD_LIMITS,
  type GuestFieldKind,
  groupFields,
  kindHasOptions,
} from '@/lib/guests/types';
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

interface FieldsResponse {
  fields: GuestProfileFieldRow[];
  answers: Record<string, number>;
  canManage: boolean;
}

interface EditState {
  label: string;
  section: string;
  hint: string;
  options: string;
  showOnRoster: boolean;
}

function editStateFor(field: GuestProfileFieldRow): EditState {
  return {
    label: field.label,
    section: field.section,
    hint: field.hint ?? '',
    options: field.options.join('\n'),
    showOnRoster: field.show_on_roster,
  };
}

export function GuestFieldsManager() {
  const { data, error, loading, setData, reload } =
    useCachedJson<FieldsResponse>('/api/admin/guest-fields');
  const fields = useMemo(() => data?.fields ?? [], [data]);
  const answers = data?.answers ?? {};

  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [deleting, setDeleting] = useState<GuestProfileFieldRow | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const sections = useMemo(
    () => [...new Set(fields.map((f) => f.section))].sort((a, b) => a.localeCompare(b)),
    [fields]
  );

  const active = useMemo(() => groupFields(fields.filter((f) => !f.archived)), [fields]);
  const archived = useMemo(
    () => fields.filter((f) => f.archived).sort((a, b) => a.label.localeCompare(b.label)),
    [fields]
  );

  const replaceField = (next: GuestProfileFieldRow) =>
    setData((prev) =>
      prev ? { ...prev, fields: prev.fields.map((f) => (f.key === next.key ? next : f)) } : prev
    );

  const afterChange = () => {
    // Profiles render from this list too.
    invalidateJson('/api/admin/guests');
  };

  const patch = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    setMessage(null);
    try {
      const { field } = await send<{ field: GuestProfileFieldRow }>(
        '/api/admin/guest-fields',
        'PATCH',
        {
          key,
          ...body,
        }
      );
      replaceField(field);
      afterChange();
      return true;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save');
      return false;
    } finally {
      setBusy(null);
    }
  };

  /**
   * Move `key` one slot up or down within its own section. The two swap
   * sort_order values, so their order relative to each other flips while
   * everything else stays put; the full active order is sent so nothing is
   * left unranked.
   */
  const nudge = async (key: string, direction: -1 | 1) => {
    const group = active.find((g) => g.fields.some((f) => f.key === key));
    if (!group) return;
    const within = group.fields.map((f) => f.key);
    const index = within.indexOf(key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= within.length) return;
    const other = within[target];

    const order = active.flatMap((g) => g.fields.map((f) => f.key));
    const a = order.indexOf(key);
    const b = order.indexOf(other);
    [order[a], order[b]] = [order[b], order[a]];

    setBusy(key);
    setMessage(null);
    try {
      const { fields: next } = await send<{ fields: GuestProfileFieldRow[] }>(
        '/api/admin/guest-fields',
        'PATCH',
        { order: [...order, ...archived.map((f) => f.key)] }
      );
      setData((prev) => (prev ? { ...prev, fields: next } : prev));
      afterChange();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not reorder');
    } finally {
      setBusy(null);
    }
  };

  const saveEdit = async (field: GuestProfileFieldRow) => {
    if (!edit) return;
    const body: Record<string, unknown> = {
      label: edit.label,
      section: edit.section,
      hint: edit.hint,
      show_on_roster: edit.showOnRoster,
    };
    if (kindHasOptions(field.kind)) body.options = edit.options;
    const ok = await patch(field.key, body);
    if (ok) {
      setEditing(null);
      setEdit(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(deleting.key);
    setMessage(null);
    try {
      await send(`/api/admin/guest-fields?key=${encodeURIComponent(deleting.key)}`, 'DELETE');
      const gone = deleting.key;
      setData((prev) =>
        prev ? { ...prev, fields: prev.fields.filter((f) => f.key !== gone) } : prev
      );
      setDeleting(null);
      afterChange();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not delete');
    } finally {
      setBusy(null);
    }
  };

  const renderField = (field: GuestProfileFieldRow) => {
    const isEditing = editing === field.key && edit;
    const count = answers[field.key] ?? 0;
    const siblings = active.find((g) => g.section === field.section)?.fields ?? [];
    const position = siblings.findIndex((f) => f.key === field.key);

    return (
      <li key={field.key} className="py-3 first:pt-0 last:pb-0">
        {!isEditing ? (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-primary-semibold text-[var(--pyre-creme)]">
                  {field.label}
                </span>
                <QuietBadge>{FIELD_KIND_LABELS[field.kind]}</QuietBadge>
                {field.show_on_roster && <QuietBadge>On roster</QuietBadge>}
                {field.archived && <QuietBadge>Retired</QuietBadge>}
              </div>
              {field.hint && <p className="mt-0.5 text-xs text-white/45">{field.hint}</p>}
              {field.options.length > 0 && (
                <p className="mt-1 text-xs text-white/55">{field.options.join(' · ')}</p>
              )}
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-white/30">
                {field.key} · {count} answer{count === 1 ? '' : 's'}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {!field.archived && (
                <>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={busy !== null || position <= 0}
                    aria-label={`Move ${field.label} up`}
                    onClick={() => void nudge(field.key, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={busy !== null || position < 0 || position >= siblings.length - 1}
                    aria-label={`Move ${field.label} down`}
                    onClick={() => void nudge(field.key, 1)}
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
                  setEditing(field.key);
                  setEdit(editStateFor(field));
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={busy !== null}
                onClick={() => void patch(field.key, { archived: !field.archived })}
              >
                {field.archived ? 'Restore' : 'Retire'}
              </button>
              {count === 0 && (
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy !== null}
                  onClick={() => setDeleting(field)}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3 rounded border border-white/10 bg-white/[0.02] p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor={`edit-label-${field.key}`}>
                  Label
                </label>
                <input
                  id={`edit-label-${field.key}`}
                  className={inputClass}
                  maxLength={FIELD_LIMITS.label}
                  value={edit.label}
                  onChange={(e) => setEdit({ ...edit, label: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor={`edit-section-${field.key}`}>
                  Section
                </label>
                <input
                  id={`edit-section-${field.key}`}
                  className={inputClass}
                  list="guest-field-sections"
                  maxLength={FIELD_LIMITS.section}
                  value={edit.section}
                  onChange={(e) => setEdit({ ...edit, section: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className={labelClass} htmlFor={`edit-hint-${field.key}`}>
                Hint (optional)
              </label>
              <input
                id={`edit-hint-${field.key}`}
                className={inputClass}
                maxLength={FIELD_LIMITS.hint}
                value={edit.hint}
                onChange={(e) => setEdit({ ...edit, hint: e.target.value })}
              />
            </div>
            {kindHasOptions(field.kind) && (
              <div>
                <label className={labelClass} htmlFor={`edit-options-${field.key}`}>
                  Options, one per line
                </label>
                <textarea
                  id={`edit-options-${field.key}`}
                  className={`${inputClass} min-h-[120px] font-mono text-sm`}
                  value={edit.options}
                  onChange={(e) => setEdit({ ...edit, options: e.target.value })}
                />
                <p className="mt-1 text-xs text-white/40">
                  Removing an option hides it from the form; profiles that already chose it keep the
                  answer until someone changes it.
                </p>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-white/80">
              <input
                type="checkbox"
                checked={edit.showOnRoster}
                onChange={(e) => setEdit({ ...edit, showOnRoster: e.target.checked })}
              />
              Show this answer on the session roster
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={primaryButtonClass}
                disabled={busy !== null || !edit.label.trim()}
                onClick={() => void saveEdit(field)}
              >
                {busy === field.key ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={busy !== null}
                onClick={() => {
                  setEditing(null);
                  setEdit(null);
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
      <datalist id="guest-field-sections">
        {sections.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <AddFieldForm
        sections={sections}
        onAdded={(field) => {
          setData((prev) => (prev ? { ...prev, fields: [...prev.fields, field] } : prev));
          afterChange();
          void reload();
        }}
      />

      {message && <p className="text-sm text-[var(--pyre-red)]">{message}</p>}
      {error && <p className="text-sm text-[var(--pyre-red)]">Couldn't load fields: {error}</p>}
      {loading && <p className="font-mono text-xs text-white/40">Loading…</p>}

      {active.map((group) => (
        <section key={group.section} className={cardClass}>
          <SectionTitle>{group.section}</SectionTitle>
          <ul className="divide-y divide-white/5">{group.fields.map(renderField)}</ul>
        </section>
      ))}

      {data && active.length === 0 && (
        <div className={cardClass}>
          <p className="text-sm text-white/60">No active fields. Add the first one above.</p>
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
              Retired fields ({archived.length})
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wide text-white/35">
              {showArchived ? 'Hide' : 'Show'}
            </span>
          </button>
          {showArchived && (
            <ul className="mt-4 divide-y divide-white/5">{archived.map(renderField)}</ul>
          )}
        </section>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.label}"?`}
          body="No profile has answered this one, so nothing is lost — but it is gone for good. Retire it instead if you might want it back."
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

function AddFieldForm({
  sections,
  onAdded,
}: {
  sections: string[];
  onAdded: (field: GuestProfileFieldRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<GuestFieldKind>('choice');
  const [section, setSection] = useState(sections[0] ?? DEFAULT_SECTION);
  const [hint, setHint] = useState('');
  const [options, setOptions] = useState('');
  const [showOnRoster, setShowOnRoster] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setLabel('');
    setKind('choice');
    setHint('');
    setOptions('');
    setShowOnRoster(false);
    setError(null);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { field } = await send<{ field: GuestProfileFieldRow }>(
        '/api/admin/guest-fields',
        'POST',
        {
          label,
          kind,
          section,
          hint,
          options,
          show_on_roster: showOnRoster,
        }
      );
      onAdded(field);
      reset();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the field');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div>
        <button type="button" className={primaryButtonClass} onClick={() => setOpen(true)}>
          Add a field
        </button>
      </div>
    );
  }

  return (
    <section className={cardClass}>
      <SectionTitle note="A new question on every profile. Its kind can't change afterwards.">
        New field
      </SectionTitle>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="new-field-label">
              Label
            </label>
            <input
              id="new-field-label"
              className={inputClass}
              maxLength={FIELD_LIMITS.label}
              placeholder="Favourite tea"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="new-field-section">
              Section
            </label>
            <input
              id="new-field-section"
              className={inputClass}
              list="guest-field-sections"
              maxLength={FIELD_LIMITS.section}
              value={section}
              onChange={(e) => setSection(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="new-field-kind">
            Kind
          </label>
          <select
            id="new-field-kind"
            className={inputClass}
            value={kind}
            onChange={(e) => setKind(e.target.value as GuestFieldKind)}
          >
            {FIELD_KINDS.map((k) => (
              <option key={k} value={k}>
                {FIELD_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-white/40">{FIELD_KIND_HINTS[kind]}</p>
        </div>

        {kindHasOptions(kind) && (
          <div>
            <label className={labelClass} htmlFor="new-field-options">
              Options, one per line
            </label>
            <textarea
              id="new-field-options"
              className={`${inputClass} min-h-[120px] font-mono text-sm`}
              placeholder={'Green\nBlack\nHerbal'}
              value={options}
              onChange={(e) => setOptions(e.target.value)}
            />
          </div>
        )}

        <div>
          <label className={labelClass} htmlFor="new-field-hint">
            Hint (optional)
          </label>
          <input
            id="new-field-hint"
            className={inputClass}
            maxLength={FIELD_LIMITS.hint}
            placeholder="Shown under the label to whoever fills it in"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-white/80">
          <input
            type="checkbox"
            checked={showOnRoster}
            onChange={(e) => setShowOnRoster(e.target.checked)}
          />
          Show this answer on the session roster
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={primaryButtonClass}
            disabled={busy || !label.trim()}
            onClick={() => void submit()}
          >
            {busy ? 'Adding…' : 'Add field'}
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => {
              reset();
              setOpen(false);
            }}
          >
            Cancel
          </button>
          {error && <span className="text-sm text-[var(--pyre-red)]">{error}</span>}
        </div>
      </div>
    </section>
  );
}

export default GuestFieldsManager;
