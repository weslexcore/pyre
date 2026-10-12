import { todayEastern } from '@pyre/schedule-core';
import { useEffect, useRef, useState } from 'react';
import { formButtonClass } from '@/components/admin/ui';
import type { Assignable } from '@/lib/boards/people';
import type { RepeatRule } from '@/lib/boards/recurrence';
import { BOARD_LIMITS, GOALS_BOARD_SLUG } from '@/lib/boards/types';
import { sendJson } from '@/lib/client/api';
import type { BoardCardRow, BoardRow } from '@/lib/db';
import type { PeopleNames } from '@/lib/sops/names';
import { AssigneePicker, DuePicker } from './boards/CardMeta';
import { namesAsOwners } from './boards/owners';
import { inputClass, primaryButtonClass, selectClass } from './goalsUi';

/** A quick capture inside global search; the API limits the board list to this viewer. */
export function SearchTaskCreate({
  initialTitle,
  boards,
  owners,
  onBack,
}: {
  initialTitle: string;
  boards: BoardRow[];
  /** The staff roster; empty for a viewer not entitled to it. */
  owners: Assignable[];
  onBack: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [board, setBoard] = useState(
    (boards.find((item) => item.slug === GOALS_BOARD_SLUG) ?? boards[0])?.slug ?? ''
  );
  const [assignees, setAssignees] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [repeat, setRepeat] = useState<RepeatRule | null>(null);
  // Without the roster, the people already named on the chosen board, the
  // way the board page itself falls back (boards/owners).
  const [boardPeople, setBoardPeople] = useState<PeopleNames>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; board: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);

  useEffect(() => {
    input.current?.focus();
  }, []);

  // Opened from a New task button, the form can mount before the boards
  // have loaded; pick the default once they arrive.
  useEffect(() => {
    if (board || boards.length === 0) return;
    setBoard((boards.find((item) => item.slug === GOALS_BOARD_SLUG) ?? boards[0]).slug);
  }, [board, boards]);

  useEffect(() => {
    setBoardPeople({});
    if (owners.length > 0 || !board) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/admin/board-cards?board=${encodeURIComponent(board)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { people?: PeopleNames };
        if (!controller.signal.aborted) setBoardPeople(data.people ?? {});
      } catch {
        // Nobody to offer; the card still takes the board's default assignees.
      }
    })();
    return () => controller.abort();
  }, [owners, board]);

  const ownerOptions = owners.length > 0 ? owners : namesAsOwners(boardPeople);
  const defaults = boards.find((item) => item.slug === board)?.default_assignee_emails ?? [];
  const nameOf = (email: string) =>
    ownerOptions.find((owner) => owner.email === email)?.name ?? boardPeople[email] ?? email;

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
          const result = await sendJson<{ card: BoardCardRow }>('/api/admin/board-cards', 'POST', {
            board,
            title: title.trim(),
            // None picked leaves the board's default assignees to the insert.
            ...(assignees.length > 0 ? { assigneeEmails: assignees } : {}),
            ...(dueDate ? { dueDate } : {}),
            ...(repeat ? { repeat } : {}),
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
          <fieldset className="space-y-1 text-sm text-white/60" disabled={saving}>
            <legend className="mb-1">Assignees and due date</legend>
            <div className="flex flex-wrap items-center gap-2">
              <AssigneePicker
                owners={ownerOptions}
                value={assignees}
                names={nameOf}
                onChange={setAssignees}
              />
              <DuePicker
                value={dueDate}
                repeat={repeat}
                today={todayEastern()}
                onDateChange={setDueDate}
                onRepeatChange={(next) => setRepeat(next)}
              />
            </div>
            {assignees.length === 0 && defaults.length > 0 && (
              <p className="text-xs text-white/40">
                Left unassigned, it goes to {defaults.map(nameOf).join(', ')}.
              </p>
            )}
          </fieldset>
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
      <button
        type="button"
        className={`${formButtonClass} ml-2`}
        onClick={onBack}
        disabled={saving}
      >
        Back to search
      </button>
    </form>
  );
}
