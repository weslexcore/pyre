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
// way, as a list saved whole. A field's kind is permanent once saved: the
// answers on the cards are shaped by it, so the kind select locks after the
// first save and a change of mind means archive it and add a new one. A
// removed field is deleted if no card has answered it and archived if one
// has, so nothing typed is ever lost.

import { useRef, useState } from 'react';
import { columnKeyOf, isLastOpenColumn } from '@/lib/boards/columns';
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
  primaryButtonClass,
  SectionTitle,
  selectBaseClass,
  send,
} from '../goalsUi';

import { ColumnOrder } from './ColumnOrder';

interface ColumnDraft {
  key: string;
  label: string;
  kind: ColumnKind;
  archived: boolean;
}

interface FieldDraft {
  /**
   * Identifies the row while it is being edited. The key of a new field
   * follows its label, so it cannot be the React key: the row would remount
   * on every keystroke and the input would lose focus.
   */
  id: string;
  key: string;
  label: string;
  kind: FieldKind;
  /** One option per line or comma; parsed by the route. */
  options: string;
  hint: string;
  showOnCard: boolean;
  archived: boolean;
  /** Not saved yet, so its kind may still change. */
  isNew: boolean;
}

export function BoardSettings({
  board,
  columns,
  fields,
  cardCount,
  busy = false,
  onSaved,
}: {
  board: BoardRow;
  columns: BoardColumnRow[];
  fields: BoardFieldRow[];
  /** How many cards a delete would take with it. */
  cardCount: number;
  busy?: boolean;
  onSaved: () => void;
}) {
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description);
  const [cardNoun, setCardNoun] = useState(board.card_noun);
  const [includeInAllTasks, setIncludeInAllTasks] = useState(board.include_in_all_tasks);
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
        archived: field.archived,
        isNew: false,
      }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'archive' | 'delete' | null>(null);

  const nextFieldId = useRef(0);

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
        kind: 'text',
        options: '',
        hint: '',
        showOnCard: false,
        archived: false,
        isNew: true,
      },
    ]);

  /** A new field's key follows its label until the first save fixes it. */
  const relabelField = (index: number, label: string) =>
    setFieldDrafts((current) =>
      current.map((draft, i) => {
        if (i !== index) return draft;
        if (!draft.isNew) return { ...draft, label };
        const taken = current.filter((_, j) => j !== i).map((other) => other.key);
        return { ...draft, label, key: label.trim() ? columnKeyOf(label, taken) : draft.key };
      })
    );

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

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await send('/api/admin/boards', 'PATCH', {
        slug: board.slug,
        name,
        description,
        cardNoun,
        includeInAllTasks,
        columns: drafts.map((draft, index) => ({ ...draft, sortOrder: (index + 1) * 10 })),
        fields: fieldDrafts.map(({ id: _id, isNew: _isNew, ...draft }, index) => ({
          ...draft,
          sortOrder: (index + 1) * 10,
        })),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the board');
    } finally {
      setSaving(false);
    }
  };

  const toggleArchived = async () => {
    setSaving(true);
    setError(null);
    try {
      await send('/api/admin/boards', 'PATCH', { slug: board.slug, archived: !board.archived });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change that');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
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
        {fieldDrafts.length === 0 && (
          <p className="mb-2 text-xs text-white/35">
            No fields yet.
          </p>
        )}
        <div className="space-y-3">
          {fieldDrafts.map((draft, index) => (
            <div key={draft.id} className="space-y-2 rounded border border-white/10 p-3">
              <div className="flex min-w-0 items-center gap-2">
                <input
                  className={`${inputBaseClass} min-w-0 flex-1`}
                  type="text"
                  maxLength={BOARD_LIMITS.fieldLabel}
                  value={draft.label}
                  aria-label={`Label for ${draft.key}`}
                  onChange={(e) => relabelField(index, e.target.value)}
                />
                <select
                  className={`${selectBaseClass} w-32 shrink-0 disabled:opacity-60`}
                  value={draft.kind}
                  disabled={!draft.isNew}
                  title={draft.isNew ? undefined : 'A saved field keeps its kind'}
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
            </div>
          ))}
        </div>
        <button type="button" className={`${buttonClass} mt-2`} onClick={addField}>
          Add field
        </button>
        <p className="mt-2 text-xs text-white/35">
          A field's kind is fixed once saved; archive it and add a new one to change it. A removed
          field is deleted if no card has answered it and archived if one has.
        </p>
      </div>

      {error && <p className="mt-3 text-sm text-[var(--pyre-red)]">{error}</p>}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          className={primaryButtonClass}
          disabled={busy || saving || !name.trim()}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save board'}
        </button>
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
