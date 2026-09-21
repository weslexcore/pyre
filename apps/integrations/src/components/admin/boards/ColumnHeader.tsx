// A column's heading on the board, and the tile that adds one. Both are the
// same PATCH — the whole column list with one thing changed (lib/boards/
// columns.ts) — so a rename from the header and a rename from Board settings
// land on the server identically, and a column keeps its cards either way.
//
// Only a manager sees the controls. A single-board grantee works the cards;
// they do not reshape the board.

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { BOARD_LIMITS } from '@/lib/boards/types';
import type { BoardColumnRow } from '@/lib/db';
import { buttonClass, inputBaseClass, SectionTitle } from '../goalsUi';

export function ColumnHeader({
  column,
  count,
  canManage = false,
  busy = false,
  onRename,
}: {
  column: BoardColumnRow;
  count: number;
  canManage?: boolean;
  busy?: boolean;
  onRename: (label: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(column.label);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const start = () => {
    setLabel(column.label);
    setEditing(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = label.trim();
    if (!trimmed || saving) return;
    if (trimmed === column.label) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onRename(trimmed);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <form onSubmit={submit} className="mb-3 flex items-center gap-2">
        <label className="sr-only" htmlFor={`rename-${column.id}`}>
          New name for {column.label}
        </label>
        <input
          ref={inputRef}
          id={`rename-${column.id}`}
          className={`${inputBaseClass} min-w-0 flex-1 py-1.5`}
          type="text"
          maxLength={BOARD_LIMITS.columnLabel}
          value={label}
          disabled={busy || saving}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(false);
          }}
        />
        <button type="submit" className={buttonClass} disabled={busy || saving || !label.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className={buttonClass} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </form>
    );
  }

  return (
    <SectionTitle
      note={
        <span className="flex items-center gap-2">
          <span>{count}</span>
          {canManage && (
            <button
              type="button"
              className="underline hover:text-white/70"
              disabled={busy}
              onClick={start}
            >
              Rename
            </button>
          )}
        </span>
      }
    >
      {column.label}
      {column.archived && <span className="ml-2 text-white/25">(retired)</span>}
    </SectionTitle>
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
