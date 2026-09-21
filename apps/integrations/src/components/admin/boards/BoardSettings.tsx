// The board's own shape: its name, what it calls a card, whether its cards
// belong on All Tasks, and its columns — and, at the bottom, the two things
// that take a board off the index: archiving it and deleting it.
//
// Columns are edited as a list and saved as a list — the route reconciles by
// key, so renaming a column keeps its cards, and dropping one archives it if
// anything is sitting in it rather than taking the cards with it. That is
// why there is no Delete button on a column: "remove" means "stop offering
// it", and the server decides whether the row can actually go. A new
// column's key is minted from its first label and kept through edits.
//
// The goal is not here: it is edited where it is shown, at the top of the
// board (BoardGoal).
//
// Fields are shown read-only. A per-board field editor is real work (see
// GuestFieldsManager for the shape it would take) and the seeded rental
// board already has the fields it needs; until somebody wants a seventh one,
// listing them is honest and an editor would be speculative.

import { useState } from 'react';
import { columnKeyOf } from '@/lib/boards/columns';
import type { ColumnKind } from '@/lib/boards/types';
import {
  BOARD_LIMITS,
  BOARDS_HREF,
  COLUMN_KIND_LABELS,
  COLUMN_KINDS,
  FIELD_KIND_LABELS,
  GOALS_BOARD_SLUG,
} from '@/lib/boards/types';
import type { BoardColumnRow, BoardFieldRow, BoardRow } from '@/lib/db';
import { ConfirmDialog } from '../ConfirmDialog';
import {
  buttonClass,
  cardClass,
  dangerButtonClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  SectionTitle,
  selectClass,
  send,
} from '../goalsUi';

interface ColumnDraft {
  key: string;
  label: string;
  kind: ColumnKind;
  archived: boolean;
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'archive' | 'delete' | null>(null);

  const setDraft = (index: number, patch: Partial<ColumnDraft>) =>
    setDrafts((current) =>
      current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft))
    );

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

      <div className="grid gap-4 sm:grid-cols-2">
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
        <div className="space-y-2">
          {drafts.map((draft, index) => (
            <div key={draft.key} className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <input
                className={inputClass}
                type="text"
                maxLength={BOARD_LIMITS.columnLabel}
                value={draft.label}
                aria-label={`Label for ${draft.key}`}
                onChange={(e) => setDraft(index, { label: e.target.value })}
              />
              <select
                className={`${selectClass} sm:w-36`}
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
              <label className="flex items-center gap-2 px-1 text-xs text-white/50">
                <input
                  type="checkbox"
                  checked={draft.archived}
                  onChange={(e) => setDraft(index, { archived: e.target.checked })}
                />
                retire
              </label>
            </div>
          ))}
        </div>
        <button type="button" className={`${buttonClass} mt-2`} onClick={addColumn}>
          Add column
        </button>
      </div>

      {fields.length > 0 && (
        <div className="mt-5 border-t border-white/10 pt-4">
          <SectionTitle note="set when the board was made">Fields</SectionTitle>
          <ul className="space-y-1 text-sm text-white/60">
            {fields.map((field) => (
              <li key={field.key} className="flex items-baseline justify-between gap-3">
                <span>{field.label}</span>
                <span className="font-mono text-[11px] text-white/35">
                  {FIELD_KIND_LABELS[field.kind]}
                  {field.show_on_card && ' · on the card'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
