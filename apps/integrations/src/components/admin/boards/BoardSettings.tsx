// The board's own shape: its name, what it calls a card, whether its cards
// belong on All Tasks, and its columns — and, at the bottom, the two things
// that take a board off the index: archiving it and deleting it.
//
// Columns are edited as a list and saved as a list — the route reconciles by
// key, so renaming a column keeps its cards, and removing one deletes it if
// it is empty and archives it if anything is sitting in it, rather than
// taking the cards with it. "Remove" here means "take it off the list", and
// the server decides whether the row can actually go. A new column's key is
// minted from its first label and kept through edits.
//
// The goal is not here: it is edited where it is shown, at the top of the
// board (BoardGoal).
//
// Fields — the questions a card on this board answers — are edited the same
// way, as a list saved whole, and reordered the same way, by dragging the
// handles (ColumnOrder). Choose a field's kind before adding it: the
// answers on the cards are shaped by it, so the first automatic save fixes
// the kind and a change of mind means archive it and add a new one. A
// removed field is deleted if no card has answered it and archived if one
// has, so nothing typed is ever lost.

import { type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { columnKeyOf, isLastOpenColumn } from '@/lib/boards/columns';
import { formBuilderHref } from '@/lib/boards/forms';
import type { ColumnKind, FieldKind } from '@/lib/boards/types';
import {
  BOARD_LIMITS,
  BOARDS_HREF,
  COLUMN_KIND_LABELS,
  COLUMN_KINDS,
  FIELD_KIND_LABELS,
  FIELD_KINDS,
  GOALS_BOARD_SLUG,
  kindHasOptions,
  kindIsTime,
} from '@/lib/boards/types';
import type { BoardColumnRow, BoardFieldRow, BoardRow } from '@/lib/db';
import { ConfirmDialog } from '../ConfirmDialog';
import {
  buttonClass,
  cardClass,
  dangerButtonClass,
  inputBaseClass,
  inputClass,
  labelClass,
  SectionTitle,
  selectBaseClass,
  send,
} from '../goalsUi';

import { ColumnOrder } from './ColumnOrder';
import { useCardAutosave } from './useCardAutosave';

export interface BoardSettingsResult {
  board: BoardRow;
  columns: BoardColumnRow[];
  fields: BoardFieldRow[];
}

export interface BoardSettingsHandle {
  flush: () => Promise<boolean>;
}

interface ColumnDraft {
  key: string;
  label: string;
  kind: ColumnKind;
  archived: boolean;
}

interface FieldDraft {
  /** Stable identity while the field is being edited. */
  id: string;
  key: string;
  label: string;
  kind: FieldKind;
  /** One option per line or comma; parsed by the route. */
  options: string;
  hint: string;
  showOnCard: boolean;
  showLabelOnCard: boolean;
  /** Only a date field can be one; the checkbox renders for nothing else. */
  showOnCalendar: boolean;
  /** The key of the time field that times it; '' is an all-day entry. */
  calendarTimeKey: string;
  archived: boolean;
}

export function BoardSettings({
  board,
  columns,
  fields,
  cardCount,
  busy = false,
  onSaved,
  ref,
}: {
  board: BoardRow;
  columns: BoardColumnRow[];
  fields: BoardFieldRow[];
  /** How many cards a delete would take with it. */
  cardCount: number;
  busy?: boolean;
  onSaved: (result: BoardSettingsResult) => void;
  ref?: Ref<BoardSettingsHandle>;
}) {
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description);
  const [cardNoun, setCardNoun] = useState(board.card_noun);
  const [includeInAllTasks, setIncludeInAllTasks] = useState(board.include_in_all_tasks);
  const [dueOnCalendar, setDueOnCalendar] = useState(board.due_on_calendar);
  const [drafts, setDrafts] = useState<ColumnDraft[]>(() =>
    [...columns]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((column) => ({
        key: column.key,
        label: column.label,
        kind: column.kind,
        archived: column.archived,
      }))
  );
  const [fieldDrafts, setFieldDrafts] = useState<FieldDraft[]>(() =>
    [...fields]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((field) => ({
        id: field.key,
        key: field.key,
        label: field.label,
        kind: field.kind,
        options: field.options.join(', '),
        hint: field.hint ?? '',
        showOnCard: field.show_on_card,
        showLabelOnCard: field.show_label_on_card !== false,
        showOnCalendar: field.show_on_calendar,
        calendarTimeKey: field.calendar_time_key ?? '',
        archived: field.archived,
      }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'archive' | 'delete' | null>(null);

  const nextFieldId = useRef(0);
  const [newFieldKind, setNewFieldKind] = useState<FieldKind>('text');

  const setFieldDraft = (index: number, patch: Partial<FieldDraft>) =>
    setFieldDrafts((current) =>
      current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft))
    );

  const removeFieldDraft = (index: number) =>
    setFieldDrafts((current) => current.filter((_, i) => i !== index));

  const addField = () =>
    setFieldDrafts((current) => [
      ...current,
      {
        id: `new-${nextFieldId.current++}`,
        key: columnKeyOf(
          'New field',
          current.map((draft) => draft.key)
        ),
        label: 'New field',
        kind: newFieldKind,
        options: '',
        hint: '',
        showOnCard: false,
        showLabelOnCard: true,
        showOnCalendar: false,
        calendarTimeKey: '',
        archived: false,
      },
    ]);

  const setDraft = (index: number, patch: Partial<ColumnDraft>) =>
    setDrafts((current) =>
      current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft))
    );

  const removeDraft = (index: number) =>
    setDrafts((current) => current.filter((_, i) => i !== index));

  const addColumn = () =>
    setDrafts((current) => [
      ...current,
      {
        key: columnKeyOf(
          'New column',
          current.map((draft) => draft.key)
        ),
        label: 'New column',
        kind: 'open',
        archived: false,
      },
    ]);

  const autosave = useCardAutosave(async (patch) => {
    const result = await send<BoardSettingsResult>('/api/admin/boards', 'PATCH', {
      slug: board.slug,
      ...patch,
    });
    onSaved(result);
  });
  useImperativeHandle(ref, () => ({ flush: autosave.flush }));

  // Compare individual settings so a rename never rewrites an unchanged
  // column or field list. The shared queue preserves edits during a request.
  const snapshot = JSON.stringify({
    name,
    description,
    cardNoun,
    includeInAllTasks,
    dueOnCalendar,
    columns: drafts.map((draft, index) => ({ ...draft, sortOrder: (index + 1) * 10 })),
    fields: fieldDrafts.map(({ id: _id, ...draft }, index) => ({
      ...draft,
      sortOrder: (index + 1) * 10,
    })),
  });
  const previous = useRef(snapshot);
  const schedule = useRef(autosave.schedule);
  schedule.current = autosave.schedule;
  useEffect(() => {
    if (previous.current === snapshot) return;
    const before = JSON.parse(previous.current);
    const after = JSON.parse(snapshot);
    const patch = Object.fromEntries(
      Object.entries(after).filter(
        ([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key])
      )
    );
    previous.current = snapshot;
    schedule.current(patch);
  }, [snapshot]);

  const settingsSaving = autosave.status === 'pending' || autosave.status === 'saving';

  const toggleArchived = async () => {
    if (!(await autosave.flush())) return;
    setSaving(true);
    setError(null);
    try {
      const result = await send<BoardSettingsResult>('/api/admin/boards', 'PATCH', {
        slug: board.slug,
        archived: !board.archived,
      });
      onSaved(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change that');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!(await autosave.flush())) return;
    setSaving(true);
    setError(null);
    try {
      await send(`/api/admin/boards?slug=${encodeURIComponent(board.slug)}`, 'DELETE');
      window.location.assign(BOARDS_HREF);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the board');
      setSaving(false);
    }
  };

  const isTasksBoard = board.slug === GOALS_BOARD_SLUG;
  const nounPlural = `${cardNoun}s`;

  return (
    <section className={cardClass}>
      <SectionTitle note={board.slug}>Board settings</SectionTitle>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="board-name">
            Name
          </label>
          <input
            id="board-name"
            className={inputClass}
            type="text"
            maxLength={BOARD_LIMITS.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="board-noun">
            One card is a…
          </label>
          <input
            id="board-noun"
            className={inputClass}
            type="text"
            maxLength={BOARD_LIMITS.cardNoun}
            value={cardNoun}
            onChange={(e) => setCardNoun(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4">
        <label className={labelClass} htmlFor="board-description">
          Description
        </label>
        <input
          id="board-description"
          className={inputClass}
          type="text"
          maxLength={BOARD_LIMITS.description}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="mt-4 space-y-2">
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input
            type="checkbox"
            checked={includeInAllTasks}
            onChange={(e) => setIncludeInAllTasks(e.target.checked)}
          />
          Show these cards on All Tasks
        </label>
        <p className="ml-6 text-xs text-white/35">
          On for work we owe; off for a pipeline, where forty open leads would drown the twelve
          things that need doing this week.
        </p>
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input
            type="checkbox"
            checked={dueOnCalendar}
            onChange={(e) => setDueOnCalendar(e.target.checked)}
          />
          Show card due dates on the calendar
        </label>
        <p className="ml-6 text-xs text-white/35">
          On for work with deadlines; off where a follow-up date is noise beside the dates the cards
          are really about.
        </p>
      </div>

      <div className="mt-5 border-t border-white/10 pt-4">
        <SectionTitle note="renaming keeps the cards">Columns</SectionTitle>
        <ColumnOrder items={drafts} disabled={busy || saving} onChange={setDrafts}>
          {(draft, index) => (
            <div key={draft.key} className="flex min-w-0 items-center gap-2">
              <input
                className={`${inputBaseClass} min-w-0 flex-1`}
                type="text"
                maxLength={BOARD_LIMITS.columnLabel}
                value={draft.label}
                aria-label={`Label for ${draft.key}`}
                onChange={(e) => setDraft(index, { label: e.target.value })}
              />
              <select
                className={`${selectBaseClass} w-32 shrink-0`}
                value={draft.kind}
                aria-label={`Kind for ${draft.key}`}
                onChange={(e) => setDraft(index, { kind: e.target.value as ColumnKind })}
              >
                {COLUMN_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {COLUMN_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
              <label className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-white/50">
                <input
                  type="checkbox"
                  checked={draft.archived}
                  onChange={(e) => setDraft(index, { archived: e.target.checked })}
                />
                archive
              </label>
              <button
                type="button"
                className="shrink-0 px-1 font-mono text-xs text-white/40 underline hover:text-[var(--pyre-red)] disabled:opacity-30"
                disabled={isLastOpenColumn(drafts, draft.key)}
                aria-label={`Remove ${draft.label}`}
                onClick={() => removeDraft(index)}
              >
                remove
              </button>
            </div>
          )}
        </ColumnOrder>
        <button type="button" className={`${buttonClass} mt-2`} onClick={addColumn}>
          Add column
        </button>
        <p className="mt-2 text-xs text-white/35">
          A removed column is deleted if it is empty and archived if it still holds cards.
        </p>
      </div>

      <div className="mt-5 border-t border-white/10 pt-4">
        <SectionTitle note="what a card asks">Fields</SectionTitle>
        {fieldDrafts.length === 0 && <p className="mb-2 text-xs text-white/35">No fields yet.</p>}
        <ColumnOrder
          items={fieldDrafts}
          disabled={busy || saving}
          onChange={setFieldDrafts}
          help="Drag the handles to reorder fields, or focus a handle and use the up and down arrow keys. The card drawer follows this order."
          helpId="field-order-help"
        >
          {(draft, index) => (
            <div className="space-y-2 rounded border border-white/10 p-3">
              <div className="flex min-w-0 items-center gap-2">
                <input
                  className={`${inputBaseClass} min-w-0 flex-1`}
                  type="text"
                  maxLength={BOARD_LIMITS.fieldLabel}
                  value={draft.label}
                  aria-label={`Label for ${draft.key}`}
                  onChange={(e) => setFieldDraft(index, { label: e.target.value })}
                />
                <select
                  className={`${selectBaseClass} w-32 shrink-0 disabled:opacity-60`}
                  value={draft.kind}
                  disabled
                  title="Choose the type before adding a field"
                  aria-label={`Kind for ${draft.key}`}
                  onChange={(e) => setFieldDraft(index, { kind: e.target.value as FieldKind })}
                >
                  {FIELD_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {FIELD_KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
                <label className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-white/50">
                  <input
                    type="checkbox"
                    checked={draft.showOnCard}
                    onChange={(e) => setFieldDraft(index, { showOnCard: e.target.checked })}
                  />
                  on card
                </label>
                {draft.showOnCard && (
                  <label className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-white/50">
                    <input
                      type="checkbox"
                      checked={draft.showLabelOnCard}
                      aria-label={`Show label for ${draft.label} on cards`}
                      onChange={(e) => setFieldDraft(index, { showLabelOnCard: e.target.checked })}
                    />
                    show label
                  </label>
                )}
                {draft.kind === 'date' && (
                  <label className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-white/50">
                    <input
                      type="checkbox"
                      checked={draft.showOnCalendar}
                      onChange={(e) =>
                        setFieldDraft(index, {
                          showOnCalendar: e.target.checked,
                          // Unchecking takes the pairing with it, so a hidden
                          // field can never be saved still naming a time.
                          calendarTimeKey: e.target.checked ? draft.calendarTimeKey : '',
                        })
                      }
                    />
                    on calendar
                  </label>
                )}
                <label className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-white/50">
                  <input
                    type="checkbox"
                    checked={draft.archived}
                    onChange={(e) => setFieldDraft(index, { archived: e.target.checked })}
                  />
                  archive
                </label>
                <button
                  type="button"
                  className="shrink-0 px-1 font-mono text-xs text-white/40 underline hover:text-[var(--pyre-red)]"
                  aria-label={`Remove ${draft.label}`}
                  onClick={() => removeFieldDraft(index)}
                >
                  remove
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {kindHasOptions(draft.kind) && (
                  <input
                    className={inputClass}
                    type="text"
                    placeholder="Options, comma-separated"
                    value={draft.options}
                    aria-label={`Options for ${draft.label}`}
                    onChange={(e) => setFieldDraft(index, { options: e.target.value })}
                  />
                )}
                <input
                  className={inputClass}
                  type="text"
                  maxLength={BOARD_LIMITS.fieldHint}
                  placeholder="Hint shown under the field (optional)"
                  value={draft.hint}
                  aria-label={`Hint for ${draft.label}`}
                  onChange={(e) => setFieldDraft(index, { hint: e.target.value })}
                />
              </div>
              {draft.kind === 'date' && draft.showOnCalendar && (
                <CalendarTiming
                  draft={draft}
                  companions={fieldDrafts.filter(
                    (other) => other.id !== draft.id && kindIsTime(other.kind) && !other.archived
                  )}
                  onChange={(calendarTimeKey) => setFieldDraft(index, { calendarTimeKey })}
                />
              )}
            </div>
          )}
        </ColumnOrder>
        <div className="mt-2 flex items-center gap-2">
          <select
            className={selectBaseClass}
            aria-label="New field type"
            value={newFieldKind}
            onChange={(e) => setNewFieldKind(e.target.value as FieldKind)}
          >
            {FIELD_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {FIELD_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
          <button type="button" className={buttonClass} onClick={addField}>
            Add field
          </button>
        </div>
        <p className="mt-2 text-xs text-white/35">
          Choose a field's type before adding it; archive it and add a new one to change it. A
          removed field is deleted if no card has answered it and archived if one has. A date field
          marked "on calendar" draws its answers on the board's calendar — pick a time field beside
          it and each entry gets a time as well as a day.
        </p>
      </div>

      <div className="mt-5 border-t border-white/10 pt-4">
        <SectionTitle note={`how a ${cardNoun} arrives from outside`}>Form</SectionTitle>
        <p className="text-xs text-white/35">
          A board can put a form in front of people — anyone with the link, or signed-in staff — and
          each submission becomes a {cardNoun} in the first open column.
        </p>
        <a className={`${buttonClass} mt-2 inline-block`} href={formBuilderHref(board.slug)}>
          Open the form builder
        </a>
      </div>

      {(error || autosave.error) && (
        <p role="alert" className="mt-3 text-sm text-[var(--pyre-red)]">
          {error || autosave.error}
        </p>
      )}
      <div className="mt-4 flex items-center justify-end gap-2">
        <p role="status" className="text-xs text-white/50">
          {autosave.error
            ? 'Changes could not be saved.'
            : settingsSaving
              ? 'Saving…'
              : 'All changes saved'}
        </p>
        {autosave.error && (
          <button type="button" className={buttonClass} onClick={() => void autosave.flush()}>
            Retry
          </button>
        )}
      </div>

      <div className="mt-5 border-t border-white/10 pt-4">
        <SectionTitle note="off the index">Archive or delete</SectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonClass}
            disabled={busy || saving}
            onClick={() => setConfirming('archive')}
          >
            {board.archived ? 'Unarchive board' : 'Archive board'}
          </button>
          {!isTasksBoard && (
            <button
              type="button"
              className={dangerButtonClass}
              disabled={busy || saving}
              onClick={() => setConfirming('delete')}
            >
              Delete board
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-white/35">
          {isTasksBoard
            ? 'Archiving hides the board under the index and keeps everything. The Tasks board cannot be deleted: All Tasks files its quick-adds here.'
            : `Archiving hides the board under the index and keeps everything. Deleting erases the board, its ${nounPlural}, and their history; the goal stays.`}
        </p>
      </div>

      {confirming === 'archive' && (
        <ConfirmDialog
          title={board.archived ? `Unarchive "${board.name}"?` : `Archive "${board.name}"?`}
          body={
            board.archived
              ? 'The board comes back to the top of the index.'
              : `The board moves under Archived on the index. Its ${nounPlural} and its goal stay exactly as they are.`
          }
          confirmLabel={board.archived ? 'Unarchive' : 'Archive'}
          busy={busy || saving}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            void toggleArchived();
          }}
        />
      )}

      {confirming === 'delete' && (
        <ConfirmDialog
          title={`Delete "${board.name}"?`}
          body={`Deletes the board and its ${cardCount} ${cardCount === 1 ? cardNoun : nounPlural}, their notes and history. This cannot be undone. The goal stays and can be picked up by another board.`}
          confirmLabel="Delete board"
          danger
          busy={busy || saving}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            void remove();
          }}
        />
      )}
    </section>
  );
}

/**
 * Which time field times a date field on the calendar. Its own line rather
 * than a sixth control on the field row, which is already four wide before a
 * phone gets to it.
 *
 * "All day" is a real answer, not an absence: a rental with a date and no
 * agreed time belongs on that day regardless.
 */
function CalendarTiming({
  draft,
  companions,
  onChange,
}: {
  draft: FieldDraft;
  companions: FieldDraft[];
  onChange: (calendarTimeKey: string) => void;
}) {
  const labelId = `calendar-time-${draft.id}`;

  if (companions.length === 0) {
    return (
      <p className="text-xs text-white/35">
        On the calendar, all day. Add a time or time-range field to this board to give it a time.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-white/50" id={labelId}>
        Timed by
      </span>
      <select
        className={`${selectBaseClass} w-auto max-w-56`}
        aria-labelledby={labelId}
        value={draft.calendarTimeKey}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">All day</option>
        {companions.map((companion) => (
          <option key={companion.id} value={companion.key}>
            {companion.label}
          </option>
        ))}
      </select>
    </div>
  );
}
