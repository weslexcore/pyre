import { useEffect, useRef, useState } from 'react';
import { BOARD_LIMITS, GOALS_BOARD_SLUG } from '@/lib/boards/types';
import type { BoardCardRow, BoardRow } from '@/lib/db';
import { buttonClass, inputClass, primaryButtonClass, selectClass, send } from './goalsUi';

/** A quick capture inside global search; the API limits the board list to this viewer. */
export function SearchTaskCreate({
  initialTitle,
  boards,
  onBack,
}: {
  initialTitle: string;
  boards: BoardRow[];
  onBack: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [board, setBoard] = useState(
    (boards.find((item) => item.slug === GOALS_BOARD_SLUG) ?? boards[0])?.slug ?? ''
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; board: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);

  useEffect(() => {
    input.current?.focus();
  }, []);

  return (
    <form
      className="min-h-0 space-y-4 overflow-y-auto p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (created || pending.current || !title.trim() || !board) return;
        pending.current = true;
        setSaving(true);
        setError(null);
        try {
          const result = await send<{ card: BoardCardRow }>('/api/admin/board-cards', 'POST', {
            board,
            title: title.trim(),
          });
          setCreated({ id: result.card.id, board });
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Could not create the task');
        } finally {
          pending.current = false;
          setSaving(false);
        }
      }}
    >
      <h2 className="text-lg font-semibold text-[var(--pyre-creme)]">Create task</h2>
      {created ? (
        <p role="status" className="text-sm text-[var(--pyre-sage)]">
          Task created.{' '}
          <a
            data-astro-reload
            className="underline"
            href={`/admin/boards/${created.board}#card-${created.id}`}
          >
            Open task →
          </a>
        </p>
      ) : (
        <>
          <label className="block space-y-1 text-sm text-white/60">
            <span>Task title</span>
            <input
              ref={input}
              className={inputClass}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={BOARD_LIMITS.title}
              required
              disabled={saving}
            />
          </label>
          <label className="block space-y-1 text-sm text-white/60">
            <span>Board</span>
            <select
              className={selectClass}
              value={board}
              onChange={(event) => setBoard(event.target.value)}
              disabled={saving}
              required
            >
              {!board && <option value="">No task boards available</option>}
              {boards.map((item) => (
                <option key={item.id} value={item.slug}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p role="alert" className="text-sm text-[var(--pyre-red)]">
              {error}
            </p>
          )}
          <button
            type="submit"
            className={primaryButtonClass}
            disabled={saving || !board || !title.trim()}
          >
            {saving ? 'Creating…' : 'Create task'}
          </button>
        </>
      )}
      <button type="button" className={`${buttonClass} ml-2`} onClick={onBack} disabled={saving}>
        Back to search
      </button>
    </form>
  );
}
