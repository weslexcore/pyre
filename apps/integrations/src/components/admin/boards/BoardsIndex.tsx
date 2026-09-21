// /admin/boards: the boards this person may open, and the form for a new one.
//
// A single-board grantee sees exactly one card here and no New board form —
// the list itself is filtered server-side, so the page never even tells them
// what else exists.

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { BOARD_LIMITS, slugOf } from '@/lib/boards/types';
import type { BoardRow } from '@/lib/db';
import {
  buttonClass,
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  QuietChip,
  SectionTitle,
  send,
} from '../goalsUi';
import { readError } from '../incidentUi';

interface BoardsResponse {
  boards: BoardRow[];
  canManage?: boolean;
}

// What a brand-new board starts with. Every board needs somewhere open to
// put a card and somewhere to finish it; the rest is the owner's to add.
const STARTER_COLUMNS = [
  { key: 'new', label: 'New', kind: 'open', sortOrder: 10 },
  { key: 'in_progress', label: 'In progress', kind: 'open', sortOrder: 20 },
  { key: 'done', label: 'Done', kind: 'done', sortOrder: 30 },
];

export function BoardsIndex() {
  const [boards, setBoards] = useState<BoardRow[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [cardNoun, setCardNoun] = useState('task');
  const [includeInAllTasks, setIncludeInAllTasks] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/boards');
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as BoardsResponse;
      setBoards(body.boards);
      setCanManage(body.canManage ?? false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the boards');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await send('/api/admin/boards', 'POST', {
        name,
        slug: slug || slugOf(name),
        cardNoun,
        includeInAllTasks,
        columns: STARTER_COLUMNS,
      });
      setName('');
      setSlug('');
      setSlugTouched(false);
      setCreating(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create that board');
    } finally {
      setBusy(false);
    }
  };

  const suggested = slugTouched ? slug : slugOf(name);

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-[var(--pyre-red)]">{error}</p>}
      {loading && boards.length === 0 && (
        <p className="font-mono text-xs text-white/40">Loading…</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {boards.map((board) => (
          <a
            key={board.id}
            href={`/admin/boards/${board.slug}`}
            className={`${cardClass} block transition-colors hover:border-white/25`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-primary-semibold text-[var(--pyre-creme)]">{board.name}</h2>
              {board.archived && <QuietChip>archived</QuietChip>}
            </div>
            {board.description && <p className="mt-1 text-sm text-white/55">{board.description}</p>}
            <p className="mt-2 font-mono text-[11px] text-white/35">
              {board.card_noun}s
              {board.include_in_all_tasks ? ' · on All Tasks' : ' · its own queue'}
            </p>
          </a>
        ))}
      </div>

      {!loading && boards.length === 0 && (
        <p className="text-sm text-white/50">No boards have been shared with you.</p>
      )}

      {canManage && !creating && (
        <button type="button" className={buttonClass} onClick={() => setCreating(true)}>
          New board
        </button>
      )}

      {canManage && creating && (
        <form onSubmit={create} className={cardClass}>
          <SectionTitle>New board</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="new-board-name">
                Name
              </label>
              <input
                id="new-board-name"
                className={inputClass}
                type="text"
                maxLength={BOARD_LIMITS.name}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="new-board-slug">
                URL name
              </label>
              <input
                id="new-board-slug"
                className={inputClass}
                type="text"
                maxLength={BOARD_LIMITS.slug}
                placeholder={slugOf(name) || 'group-bookings'}
                value={suggested}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
              />
              <p className="mt-1 text-xs text-white/35">
                Permanent: it is the address and the grant key (board:{suggested || '…'}).
              </p>
            </div>
            <div>
              <label className={labelClass} htmlFor="new-board-noun">
                One card is a…
              </label>
              <input
                id="new-board-noun"
                className={inputClass}
                type="text"
                maxLength={BOARD_LIMITS.cardNoun}
                value={cardNoun}
                onChange={(e) => setCardNoun(e.target.value)}
              />
            </div>
          </div>

          <label className="mt-4 flex items-center gap-2 text-sm text-white/70">
            <input
              type="checkbox"
              checked={includeInAllTasks}
              onChange={(e) => setIncludeInAllTasks(e.target.checked)}
            />
            Show these cards on All Tasks
          </label>

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={buttonClass} onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button
              type="submit"
              className={primaryButtonClass}
              disabled={busy || !name.trim() || !suggested}
            >
              {busy ? 'Creating…' : 'Create board'}
            </button>
          </div>
          <p className="mt-2 text-xs text-white/35">
            It starts with New / In progress / Done — rename them, add your own, in board settings.
          </p>
        </form>
      )}
    </div>
  );
}
