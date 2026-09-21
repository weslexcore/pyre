// A column's heading on the board — with a plus that opens a quick-add
// straight into that column, so a lead can be written down as Quoted rather
// than as New and then moved — and the tile that adds a column. The column
// edits are the same PATCH — the whole column list with one thing changed (lib/boards/
// columns.ts) — so a rename from the header and a rename from Board settings
// land on the server identically, and a column keeps its cards either way.
//
// An empty column can also be deleted from its header. Only an empty one:
// the server archives a column that still holds cards rather than deleting
// it, so the header offers Delete only when it would actually delete.
//
// Only a manager sees the controls. A single-board grantee works the cards;
// they do not reshape the board.

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { BOARD_LIMITS } from '@/lib/boards/types';
import type { BoardColumnRow } from '@/lib/db';
import { buttonClass, inputBaseClass, SectionTitle } from '../goalsUi';
import { QuickAdd } from './QuickAdd';

export function ColumnHeader({
  column,
  count,
  noun = 'card',
  busy = false,
  onAdd,
}: {
  column: BoardColumnRow;
  count: number;
  /** What this board calls a card — for the plus button's label. */
  noun?: string;
  busy?: boolean;
  /** Quick-add into this column; absent on an archived column. */
  onAdd?: (title: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <>
      <SectionTitle
        note={
          <span className="flex items-center gap-2">
            <span>{count}</span>
            {onAdd && (
              <button
                type="button"
                className="flex h-6 w-6 items-center justify-center rounded border border-white/15 text-sm leading-none text-white/60 hover:border-white/40 hover:text-white disabled:opacity-40"
                disabled={busy}
                aria-label={`Add a ${noun} to ${column.label}`}
                aria-expanded={adding}
                onClick={() => setAdding((open) => !open)}
              >
                +
              </button>
            )}
          </span>
        }
      >
        {column.label}
        {column.archived && <span className="ml-2 text-white/25">(archived)</span>}
      </SectionTitle>

      {adding && onAdd && (
        <div className="mb-3">
          <QuickAdd
            noun={noun}
            placeholder={`Add a ${noun} to ${column.label}…`}
            busy={busy}
            focusOnMount
            onAdd={onAdd}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}
    </>
  );
}

/** The last tile in the grid: a name, and the column exists. */
export function AddColumn({
  busy = false,
  onAdd,
}: {
  busy?: boolean;
  onAdd: (label: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = label.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onAdd(trimmed);
      setLabel('');
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="flex min-h-[7rem] w-full items-center justify-center rounded border border-dashed border-white/15 p-4 font-mono text-xs uppercase tracking-wide text-white/40 transition-colors hover:border-white/30 hover:text-white/70 disabled:opacity-40"
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        Add column
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex min-h-[7rem] flex-col justify-center gap-2 rounded border border-dashed border-white/15 p-4"
    >
      <label className="sr-only" htmlFor="new-column-label">
        Column name
      </label>
      <input
        ref={inputRef}
        id="new-column-label"
        className={inputBaseClass}
        type="text"
        maxLength={BOARD_LIMITS.columnLabel}
        placeholder="Follow up"
        value={label}
        disabled={busy || saving}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      <div className="flex gap-2">
        <button type="submit" className={buttonClass} disabled={busy || saving || !label.trim()}>
          {saving ? 'Adding…' : 'Add'}
        </button>
        <button type="button" className={buttonClass} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <p className="font-mono text-[10px] text-white/30">
        Starts as an in-flight column; change that in Board settings.
      </p>
    </form>
  );
}
