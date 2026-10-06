// Changing a saved view: what it groups by, how a date buckets, how it lays
// out, the order within a group, and what shows. There is no Save button:
// each change is the view at once — the grouped cards below follow it as it
// is made — and goes to the server on its own, a pick straight away and a
// name once the typing stops (useCardAutosave, the queue the card drawer and
// board settings use). A new view is made by "+ View" before this opens
// (newViewDefaults), so there is never a half-made view to save.
//
// Anyone who can open the board can do this; the views are the board's,
// shared.

import { useEffect, useRef, useState } from 'react';
import { formButtonClass } from '@/components/admin/ui';
import {
  BOARD_LIMITS,
  DATE_UNIT_LABELS,
  DATE_UNITS,
  VIEW_LAYOUT_LABELS,
  VIEW_LAYOUTS,
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
import { useCardAutosave } from './useCardAutosave';

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

/** Every setting a patch can carry, by the API's names. */
const VIEW_KEYS = [
  'name',
  'groupBy',
  'groupFieldKey',
  'dateUnit',
  'layout',
  'sortBy',
  'hideFinished',
  'showEmpty',
  'showStatus',
];

/** How long a name waits after the last keystroke before it is saved. */
const NAME_DELAY = 600;

/** The group-by select's value for a view: a built-in, or field:<key>. */
function groupChoiceOf(view: Pick<BoardViewRow, 'group_by' | 'group_field_key'>): string {
  return view.group_by === 'field' ? `field:${view.group_field_key}` : view.group_by;
}

export function ViewEditor({
  view,
  fields,
  onChange,
  onDeleted,
  onClose,
}: {
  view: BoardViewRow;
  fields: BoardFieldRow[];
  /** The view as edited, before the server confirms it, so the page follows along. */
  onChange: (view: BoardViewRow) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const groupable = groupableFields(fields);
  const sortable = sortableFields(fields);
  const [draft, setDraft] = useState(view);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const autosave = useCardAutosave(async (patch) => {
    await sendJson('/api/admin/board-views', 'PATCH', { id: view.id, ...patch });
  });

  // Closing the editor any way at all — Done, the Edit view pill, another
  // view's pill — sends what is still waiting rather than dropping it.
  const flush = useRef(autosave.flush);
  flush.current = autosave.flush;
  useEffect(() => () => void flush.current(), []);

  /** Show `next` at once, and send `body` (the API's names) after `delay`. */
  const update = (next: Partial<BoardViewRow>, body: Record<string, unknown>, delay = 0) => {
    const merged = { ...draft, ...next };
    setDraft(merged);
    // A blank name is shown in the box while it is being retyped, but the
    // pill keeps the last real one and nothing goes to the server.
    if (merged.name.trim()) onChange(merged);
    if (next.name !== undefined && !merged.name.trim()) return;
    autosave.schedule(body, delay);
  };

  const fieldKey = draft.group_by === 'field' ? draft.group_field_key : null;
  const groupField = fieldKey ? fields.find((field) => field.key === fieldKey) : undefined;
  const dated = groupsByDate(draft.group_by, groupField?.kind);
  // A view saved on a field that has since gone keeps it listed, so the
  // select says what the view was rather than silently showing another.
  const missingField = fieldKey !== null && !groupable.some((field) => field.key === fieldKey);

  // A grouping, its field, and its date unit go together, in one save: the
  // route judges them as a whole, and a unit without a date is refused.
  const pickGroup = (choice: string) => {
    const key = choice.startsWith('field:') ? choice.slice('field:'.length) : null;
    const groupBy = (key ? 'field' : choice) as BoardViewRow['group_by'];
    const kind = key ? fields.find((field) => field.key === key)?.kind : undefined;
    const unit = groupsByDate(groupBy, kind) ? (draft.date_unit ?? 'month') : null;
    // A date or number field is most often sorted by itself.
    const sortBy =
      key && draft.sort_by === 'manual' && sortable.some((field) => field.key === key)
        ? `field:${key}`
        : draft.sort_by;
    update(
      { group_by: groupBy, group_field_key: key, date_unit: unit, sort_by: sortBy },
      { groupBy, groupFieldKey: key, dateUnit: unit, sortBy }
    );
  };

  const close = async () => {
    if (await autosave.flush()) onClose();
  };

  const remove = async () => {
    const confirmed = await confirmAction({
      title: `Delete "${draft.name.trim() || view.name}"?`,
      body: 'The view goes for everyone on this board. The cards are not touched.',
      confirmLabel: 'Delete view',
      danger: true,
    });
    if (!confirmed) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      // Nothing waiting should be sent to a view about to be gone.
      for (const key of VIEW_KEYS) autosave.discard(key);
      await sendJson(`/api/admin/board-views?id=${view.id}`, 'DELETE');
      onDeleted(view.id);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Could not delete this view');
      setDeleting(false);
    }
  };

  const statusNote =
    autosave.status === 'error' ? null : autosave.status === 'saved' ? 'Saved' : 'Saving…';

  return (
    <section className={cardClass}>
      <SectionTitle note="everyone on this board sees it">Edit view</SectionTitle>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="view-name">
            Name
          </label>
          <input
            id="view-name"
            className={inputClass}
            type="text"
            maxLength={BOARD_LIMITS.viewName}
            value={draft.name}
            onChange={(e) => update({ name: e.target.value }, { name: e.target.value }, NAME_DELAY)}
          />
          {!draft.name.trim() && (
            <p className="mt-1 text-xs text-[var(--pyre-red)]">A view needs a name.</p>
          )}
        </div>
        <div>
          <label className={labelClass} htmlFor="view-group">
            Group by
          </label>
          <select
            id="view-group"
            className={selectClass}
            value={groupChoiceOf(draft)}
            onChange={(e) => pickGroup(e.target.value)}
          >
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
                  <option value={groupChoiceOf(draft)} disabled>
                    A removed field
                  </option>
                )}
              </optgroup>
            )}
          </select>
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
                    checked={draft.date_unit === unit}
                    onChange={() => update({ date_unit: unit }, { dateUnit: unit })}
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
                  checked={draft.layout === option}
                  onChange={() => update({ layout: option }, { layout: option })}
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
            value={draft.sort_by}
            onChange={(e) => update({ sort_by: e.target.value }, { sortBy: e.target.value })}
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
            checked={draft.hide_finished}
            onChange={(e) =>
              update({ hide_finished: e.target.checked }, { hideFinished: e.target.checked })
            }
          />
          Hide finished cards
        </label>
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input
            type="checkbox"
            checked={draft.show_status}
            onChange={(e) =>
              update({ show_status: e.target.checked }, { showStatus: e.target.checked })
            }
          />
          Show status on cards
        </label>
        <p className="ml-6 text-xs text-white/35">
          The column each card sits in, by name. Off leaves the cards without it.
        </p>
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input
            type="checkbox"
            checked={draft.show_empty}
            onChange={(e) =>
              update({ show_empty: e.target.checked }, { showEmpty: e.target.checked })
            }
          />
          Show empty groups
        </label>
        <p className="ml-6 text-xs text-white/35">
          For groupings whose groups are known ahead: columns, a field's options, yes and no,
          checklist progress.
        </p>
      </div>

      {(autosave.error || deleteError) && (
        <p className="mt-3 text-sm text-[var(--pyre-red)]">{autosave.error ?? deleteError}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className={formButtonClass} disabled={deleting} onClick={close}>
          Done
        </button>
        {statusNote && (
          <span className="font-mono text-xs text-white/40" aria-live="polite">
            {statusNote}
          </span>
        )}
        <button
          type="button"
          className={`${dangerButtonClass} ml-auto`}
          disabled={deleting}
          onClick={remove}
        >
          Delete view
        </button>
      </div>
    </section>
  );
}
