// Making or changing a saved view: what it groups by, how a date buckets,
// how it lays out, the order within a group, and whether finished and empty
// ones show. Saved with a button, not as you type — a view half-set-up (a
// date grouping with no field picked yet) is nothing anyone should be
// switched onto. Anyone who can open the board can do this; the views are
// the board's, shared.

import { useState } from 'react';
import { goldButtonClass } from '@/components/admin/ui';
import {
  BOARD_LIMITS,
  DATE_UNIT_LABELS,
  DATE_UNITS,
  type DateUnit,
  VIEW_LAYOUT_LABELS,
  VIEW_LAYOUTS,
  type ViewLayout,
} from '@/lib/boards/types';
import { groupableFields, groupsByDate, sortableFields } from '@/lib/boards/views';
import { sendJson } from '@/lib/client/api';
import type { BoardFieldRow, BoardViewRow } from '@/lib/db';
import { confirmAction } from '../ConfirmDialog';
import {
  cardClass,
  dangerButtonClass,
  inputClass,
  labelClass,
  SectionTitle,
  selectClass,
} from '../goalsUi';

const BUILT_INS: { value: string; label: string }[] = [
  { value: 'column', label: 'Column' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'due_date', label: 'Due date' },
  { value: 'created_at', label: 'Date added' },
];

const SORTS: { value: string; label: string }[] = [
  { value: 'manual', label: 'Board order' },
  { value: 'due_date', label: 'Due date' },
  { value: 'title', label: 'Title' },
  { value: 'created_at', label: 'Newest first' },
];

/** The group-by select's value for a view: a built-in, or field:<key>. */
function groupChoiceOf(view: BoardViewRow | null): string {
  if (!view) return '';
  return view.group_by === 'field' ? `field:${view.group_field_key}` : view.group_by;
}

export function ViewEditor({
  slug,
  view,
  fields,
  onSaved,
  onDeleted,
  onClose,
}: {
  slug: string;
  /** Null for a new view. */
  view: BoardViewRow | null;
  fields: BoardFieldRow[];
  onSaved: (view: BoardViewRow) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const groupable = groupableFields(fields);
  const sortable = sortableFields(fields);

  const [name, setName] = useState(view?.name ?? '');
  const [groupChoice, setGroupChoice] = useState(groupChoiceOf(view));
  const [dateUnit, setDateUnit] = useState<DateUnit>(view?.date_unit ?? 'month');
  const [layout, setLayout] = useState<ViewLayout>(view?.layout ?? 'sections');
  const [sortBy, setSortBy] = useState(view?.sort_by ?? 'manual');
  const [hideFinished, setHideFinished] = useState(view?.hide_finished ?? true);
  const [showEmpty, setShowEmpty] = useState(view?.show_empty ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fieldKey = groupChoice.startsWith('field:') ? groupChoice.slice('field:'.length) : null;
  const groupBy = (fieldKey ? 'field' : groupChoice) as BoardViewRow['group_by'];
  const groupField = fieldKey ? fields.find((field) => field.key === fieldKey) : undefined;
  const dated = groupChoice !== '' && groupsByDate(groupBy, groupField?.kind);
  // A view saved on a field that has since gone keeps it listed, so the
  // select says what the view was rather than silently showing another.
  const missingField = fieldKey !== null && !groupable.some((field) => field.key === fieldKey);

  const pickGroup = (next: string) => {
    setGroupChoice(next);
    // The obvious name for a fresh view, until somebody types their own.
    if (!view && (name === '' || name === suggestedName(groupChoice))) {
      setName(suggestedName(next));
    }
    // A date field is most often sorted by itself.
    const key = next.startsWith('field:') ? next.slice('field:'.length) : null;
    if (key && sortBy === 'manual' && sortable.some((field) => field.key === key)) {
      setSortBy(`field:${key}`);
    }
  };

  const suggestedName = (choice: string): string => {
    if (!choice) return '';
    const builtIn = BUILT_INS.find((option) => option.value === choice);
    const label =
      builtIn?.label ?? fields.find((field) => `field:${field.key}` === choice)?.label ?? '';
    return `By ${label.toLowerCase()}`.slice(0, BOARD_LIMITS.viewName);
  };

  const save = async () => {
    if (!groupChoice) {
      setError('Pick what this view groups by');
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      name,
      groupBy,
      groupFieldKey: fieldKey,
      dateUnit: dated ? dateUnit : null,
      layout,
      sortBy,
      hideFinished,
      showEmpty,
    };
    try {
      const result = view
        ? await sendJson<{ view: BoardViewRow }>('/api/admin/board-views', 'PATCH', {
            id: view.id,
            ...body,
          })
        : await sendJson<{ view: BoardViewRow }>('/api/admin/board-views', 'POST', {
            board: slug,
            ...body,
          });
      onSaved(result.view);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this view');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!view) return;
    const confirmed = await confirmAction({
      title: `Delete "${view.name}"?`,
      body: 'The view goes for everyone on this board. The cards are not touched.',
      confirmLabel: 'Delete view',
      danger: true,
    });
    if (!confirmed) return;
    setSaving(true);
    setError(null);
    try {
      await sendJson(`/api/admin/board-views?id=${view.id}`, 'DELETE');
      onDeleted(view.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete this view');
      setSaving(false);
    }
  };

  return (
    <section className={cardClass}>
      <SectionTitle note="everyone on this board sees it">
        {view ? 'Edit view' : 'New view'}
      </SectionTitle>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="view-group">
            Group by
          </label>
          <select
            id="view-group"
            className={selectClass}
            value={groupChoice}
            onChange={(e) => pickGroup(e.target.value)}
          >
            <option value="" disabled>
              Pick one
            </option>
            <optgroup label="The board">
              {BUILT_INS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
            {(groupable.length > 0 || missingField) && (
              <optgroup label="Fields">
                {groupable.map((field) => (
                  <option key={field.key} value={`field:${field.key}`}>
                    {field.label}
                  </option>
                ))}
                {missingField && (
                  <option value={groupChoice} disabled>
                    A removed field
                  </option>
                )}
              </optgroup>
            )}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="view-name">
            Name
          </label>
          <input
            id="view-name"
            className={inputClass}
            type="text"
            maxLength={BOARD_LIMITS.viewName}
            placeholder="By month"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {dated && (
          <div>
            <span className={labelClass}>Group dates by</span>
            <div className="flex flex-wrap gap-3">
              {DATE_UNITS.map((unit) => (
                <label key={unit} className="flex items-center gap-1.5 text-sm text-white/70">
                  <input
                    type="radio"
                    name="view-date-unit"
                    checked={dateUnit === unit}
                    onChange={() => setDateUnit(unit)}
                  />
                  {DATE_UNIT_LABELS[unit]}
                </label>
              ))}
            </div>
          </div>
        )}

        <div>
          <span className={labelClass}>Layout</span>
          <div className="flex flex-wrap gap-3">
            {VIEW_LAYOUTS.map((option) => (
              <label key={option} className="flex items-center gap-1.5 text-sm text-white/70">
                <input
                  type="radio"
                  name="view-layout"
                  checked={layout === option}
                  onChange={() => setLayout(option)}
                />
                {VIEW_LAYOUT_LABELS[option]}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="view-sort">
            Within a group, sort by
          </label>
          <select
            id="view-sort"
            className={selectClass}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            {sortable.map((field) => (
              <option key={field.key} value={`field:${field.key}`}>
                {field.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input
            type="checkbox"
            checked={hideFinished}
            onChange={(e) => setHideFinished(e.target.checked)}
          />
          Hide finished cards
        </label>
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input
            type="checkbox"
            checked={showEmpty}
            onChange={(e) => setShowEmpty(e.target.checked)}
          />
          Show empty groups
        </label>
        <p className="ml-6 text-xs text-white/35">
          For groupings whose groups are known ahead: columns, a field's options, yes and no,
          checklist progress.
        </p>
      </div>

      {error && <p className="mt-3 text-sm text-[var(--pyre-red)]">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className={goldButtonClass} disabled={saving} onClick={save}>
          {view ? 'Save view' : 'Create view'}
        </button>
        <button
          type="button"
          className="px-2 font-mono text-xs text-white/50 underline hover:text-white"
          disabled={saving}
          onClick={onClose}
        >
          Cancel
        </button>
        {view && (
          <button
            type="button"
            className={`${dangerButtonClass} ml-auto`}
            disabled={saving}
            onClick={remove}
          >
            Delete view
          </button>
        )}
      </div>
    </section>
  );
}
