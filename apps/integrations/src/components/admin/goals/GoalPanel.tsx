// One goal, opened on the goals overview: everything the board's goal
// section does, for a goal whether or not a board serves it. Write it, call
// it met, drop it, delete it; define and measure its KPIs; read and add to
// its trail; and point a board at it, or let a board go of it.
//
// The overview is only reachable with the whole boards tool, so everything
// here is open to whoever sees it — the same people canManage lets through
// on a board.

import { useMemo, useState } from 'react';
import type { BoardColumnRow, BoardRow } from '@/lib/db';
import { completionPreview } from '@/lib/goals/access';
import type { GoalOverviewRow } from '@/lib/goals/overview';
import type { GoalsOverviewData } from '@/lib/goals/store';
import { ConfirmDialog } from '../ConfirmDialog';
import { buttonClass, dangerButtonClass, primaryButtonClass, selectClass, send } from '../goalsUi';
import { SopMarkdown } from '../SopMarkdown';
import { ActivityFeed } from './ActivityFeed';
import { CompleteGoalDialog } from './CompleteGoalDialog';
import { GoalForm } from './GoalForm';
import { GoalKpis } from './GoalKpis';

export function GoalPanel({
  row,
  data,
  nowIso,
  busy,
  mutate,
}: {
  row: GoalOverviewRow;
  data: GoalsOverviewData;
  nowIso: string;
  busy: boolean;
  /** Runs a write and reloads the overview; rejects with the API's message. */
  mutate: (run: () => Promise<unknown>) => Promise<void>;
}) {
  const { goal, board, kpis } = row;
  const noun = board?.card_noun ?? 'task';
  const [editing, setEditing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [detaching, setDetaching] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [boardSlug, setBoardSlug] = useState('');

  // A board serves one goal, so only a board with none is offered; an
  // archived board is not somewhere new work goes.
  const freeBoards = useMemo(
    () => data.boards.filter((item) => !item.goal_id && !item.archived),
    [data.boards]
  );
  const columnsById = useMemo(
    () => new Map<string, BoardColumnRow>(data.columns.map((column) => [column.id, column])),
    [data.columns]
  );
  const preview = useMemo(
    () =>
      completionPreview(
        kpis,
        data.cards.filter((card) => card.goal_id === goal.id),
        columnsById
      ),
    [kpis, data.cards, goal.id, columnsById]
  );

  const quietly = (run: () => Promise<unknown>) => {
    // mutate has already put the message on the page.
    mutate(run).catch(() => undefined);
  };

  if (editing) {
    return (
      <GoalForm
        goal={goal}
        owners={data.owners}
        busy={busy}
        onCancel={() => setEditing(false)}
        onSave={async (values) => {
          await mutate(() => send('/api/admin/goals', 'PATCH', { id: goal.id, ...values }));
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass} onClick={() => setEditing(true)}>
          Edit
        </button>
        {goal.status !== 'completed' && (
          <button
            type="button"
            className={primaryButtonClass}
            disabled={busy}
            onClick={() => setCompleting(true)}
          >
            Mark completed
          </button>
        )}
        <button type="button" className={dangerButtonClass} onClick={() => setDeleting(true)}>
          Delete
        </button>
      </div>

      <BoardLink
        board={board}
        freeBoards={freeBoards}
        boardSlug={boardSlug}
        busy={busy}
        onPick={setBoardSlug}
        onAttach={() =>
          quietly(async () => {
            await send('/api/admin/boards', 'PATCH', { slug: boardSlug, goalId: goal.id });
            setBoardSlug('');
          })
        }
        onDetach={() => setDetaching(true)}
      />

      <GoalKpis
        goalId={goal.id}
        kpis={kpis}
        nowIso={nowIso}
        busy={busy}
        canManage
        canMeasure
        mutate={mutate}
      />

      {goal.description_md.trim() && (
        <div className="border-t border-white/10 pt-3">
          <SopMarkdown content={goal.description_md} />
        </div>
      )}

      <div className="border-t border-white/10 pt-3">
        <ActivityFeed
          goalId={goal.id}
          subjectTitle={goal.title}
          columns={data.columns}
          people={data.people}
        />
      </div>

      {completing && (
        <CompleteGoalDialog
          goalTitle={goal.title}
          preview={preview}
          busy={busy}
          onCancel={() => setCompleting(false)}
          onConfirm={(note) => {
            setCompleting(false);
            quietly(() =>
              send('/api/admin/goals', 'PATCH', {
                id: goal.id,
                status: 'completed',
                completionNote: note || null,
              })
            );
          }}
        />
      )}

      {detaching && board && (
        <ConfirmDialog
          title={`Detach this goal from ${board.name}?`}
          body={`"${goal.title}" keeps its KPIs and its history and can be picked up by another board. The ${noun}s on ${board.name} stop counting toward it.`}
          confirmLabel="Detach"
          busy={busy}
          onCancel={() => setDetaching(false)}
          onConfirm={() => {
            setDetaching(false);
            quietly(() => send('/api/admin/boards', 'PATCH', { slug: board.slug, goalId: null }));
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete “${goal.title}”?`}
          body={`The goal, its KPIs and every measurement, and its history are gone for good.${
            board ? ` ${board.name} and its ${noun}s stay.` : ''
          } To keep the record instead, mark it dropped.`}
          confirmLabel="Delete goal"
          danger
          busy={busy}
          onCancel={() => setDeleting(false)}
          onConfirm={() => {
            const id = goal.id;
            setDeleting(false);
            quietly(() => send(`/api/admin/goals?id=${id}`, 'DELETE'));
          }}
        />
      )}
    </div>
  );
}

/** The board serving the goal, with a way out — or a way to pick one. */
function BoardLink({
  board,
  freeBoards,
  boardSlug,
  busy,
  onPick,
  onAttach,
  onDetach,
}: {
  board: BoardRow | null;
  freeBoards: BoardRow[];
  boardSlug: string;
  busy: boolean;
  onPick: (slug: string) => void;
  onAttach: () => void;
  onDetach: () => void;
}) {
  if (board) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-mono text-[10px] uppercase tracking-wide text-white/35">Board</p>
        <a
          className="text-sm text-[var(--pyre-creme)] underline hover:text-white"
          href={`/admin/boards/${board.slug}`}
        >
          {board.name}
          {board.archived && ' (archived)'}
        </a>
        <button type="button" className={buttonClass} disabled={busy} onClick={onDetach}>
          Detach
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="font-mono text-[10px] uppercase tracking-wide text-white/35">Board</p>
      {freeBoards.length === 0 ? (
        <p className="font-mono text-xs text-white/35">
          None. Every open board already serves a goal.
        </p>
      ) : (
        <>
          <label className="sr-only" htmlFor="goal-attach-board">
            Board to serve this goal
          </label>
          <select
            id="goal-attach-board"
            className={`${selectClass} w-auto`}
            value={boardSlug}
            onChange={(e) => onPick(e.target.value)}
          >
            <option value="">No board yet</option>
            {freeBoards.map((item) => (
              <option key={item.id} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={buttonClass}
            disabled={busy || !boardSlug}
            onClick={onAttach}
          >
            Attach
          </button>
        </>
      )}
    </div>
  );
}
