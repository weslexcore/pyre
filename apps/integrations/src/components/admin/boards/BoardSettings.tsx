// The board's own shape: its name, what it calls a card, whether its cards
// belong on All Tasks, and its columns.
//
// Columns are edited as a list and saved as a list — the route reconciles by
// key, so renaming a column keeps its cards, and dropping one archives it if
// anything is sitting in it rather than taking the cards with it. That is
// why there is no Delete button here: "remove" means "stop offering it", and
// the server decides whether the row can actually go.
//
// Fields are shown read-only. A per-board field editor is real work (see
// GuestFieldsManager for the shape it would take) and the seeded rental
// board already has the fields it needs; until somebody wants a seventh one,
// listing them is honest and an editor would be speculative.

import { useState } from 'react';
import type { ColumnKind } from '@/lib/boards/types';
import {
  BOARD_LIMITS,
  COLUMN_KIND_LABELS,
  COLUMN_KINDS,
  FIELD_KIND_LABELS,
} from '@/lib/boards/types';
import type { BoardColumnRow, BoardFieldRow, BoardRow } from '@/lib/db';
import {
  buttonClass,
  cardClass,
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
  busy = false,
  onSaved,
}: {
  board: BoardRow;
  columns: BoardColumnRow[];
  fields: BoardFieldRow[];
  busy?: boolean;
  onSaved: () => void;
}) {
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description);
  const [cardNoun, setCardNoun] = useState(board.card_noun);
  const [includeInAllTasks, setIncludeInAllTasks] = useState(board.include_in_all_tasks);
  const [archived, setArchived] = useState(board.archived);
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

  const setDraft = (index: number, patch: Partial<ColumnDraft>) =>
    setDrafts((current) =>
      current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft))
    );

  const addColumn = () =>
    setDrafts((current) => [
      ...current,
      { key: `column_${current.length + 1}`, label: 'New column', kind: 'open', archived: false },
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
        archived,
        columns: drafts.map((draft, index) => ({ ...draft, sortOrder: (index + 1) * 10 })),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the board');
    } finally {
      setSaving(false);
    }
  };

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
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Archive this board
        </label>
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
    </section>
  );
}
