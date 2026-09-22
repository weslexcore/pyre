// The goal a board serves, at the top of the board: what we are trying to
// achieve, the KPIs that say whether we got there, and the task bar for the
// cards below. Everything the old goal page did, on the board it was for.
//
// Two progress reads that never merge — the KPI meters are outcome, the task
// bar is output — because the case that matters is exactly the one where
// they disagree.
//
// Completion is a button, never a consequence. Pressing it opens a dialog
// showing both numbers and asking what was true; the answer is stored on the
// goal and in its trail.
//
// Who may do what follows the board's grants: anyone who can open the board
// sees the goal and may type in a KPI measurement (canWorkGoal); writing the
// goal, defining KPIs, detaching it, and calling it met need the whole tool
// (canManage).

import { useMemo, useState } from 'react';
import type { Assignable } from '@/lib/boards/people';
import type { BoardCardRow, BoardColumnRow, BoardRow, GoalKpiRow, GoalRow } from '@/lib/db';
import { completionPreview } from '@/lib/goals/access';
import { formatDaysLeft, goalRollup } from '@/lib/goals/progress';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { ConfirmDialog } from '../ConfirmDialog';
import { CompleteGoalDialog } from '../goals/CompleteGoalDialog';
import { GoalForm } from '../goals/GoalForm';
import { KpiForm } from '../goals/KpiForm';
import { KpiRow } from '../goals/KpiRow';
import {
  buttonClass,
  formatYmd,
  GoalStatusBadge,
  PaceChip,
  primaryButtonClass,
  QuietChip,
  raisedCardClass,
  SectionTitle,
  selectClass,
  send,
  TaskBar,
} from '../goalsUi';
import { SopMarkdown } from '../SopMarkdown';

export function BoardGoal({
  board,
  goal,
  kpis,
  cards,
  columns,
  people,
  owners,
  unattachedGoals = [],
  today,
  canManage,
  canWorkGoal,
  busy,
  mutate,
  onCompleted,
}: {
  board: BoardRow;
  goal: GoalRow | null;
  kpis: GoalKpiRow[];
  cards: BoardCardRow[];
  columns: BoardColumnRow[];
  people: PeopleNames;
  owners: Assignable[];
  /** Open goals no board serves yet — offered when this board has none. */
  unattachedGoals?: GoalRow[];
  today: string;
  canManage: boolean;
  canWorkGoal: boolean;
  busy: boolean;
  /** Runs a write and reloads the board; rejects with the API's message. */
  mutate: (run: () => Promise<unknown>) => Promise<void>;
  /** Fired once a completion has actually landed. */
  onCompleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [settingGoal, setSettingGoal] = useState(false);
  const [existingId, setExistingId] = useState('');
  const [kpiFormFor, setKpiFormFor] = useState<GoalKpiRow | 'new' | null>(null);
  const [removingKpi, setRemovingKpi] = useState<GoalKpiRow | null>(null);
  const [completing, setCompleting] = useState(false);
  const [detaching, setDetaching] = useState(false);

  const columnsById = useMemo(
    () => new Map(columns.map((column) => [column.id, column])),
    [columns]
  );
  const rollup = useMemo(
    () => (goal ? goalRollup(goal, [], cards, kpis, columnsById, today) : null),
    [goal, cards, kpis, columnsById, today]
  );

  const nowIso = new Date().toISOString();

  if (!goal || !rollup) {
    if (!canManage) return null;
    return (
      <section className={raisedCardClass}>
        {/* <SectionTitle>Goal</SectionTitle> */}
        {settingGoal ? (
          <GoalForm
            owners={owners}
            busy={busy}
            heading="What is this board for?"
            onCancel={() => setSettingGoal(false)}
            onSave={async (values) => {
              await mutate(() =>
                send('/api/admin/goals', 'POST', { ...values, boardSlug: board.slug })
              );
              setSettingGoal(false);
            }}
          />
        ) : (
          <div className="space-y-3">
            {/* <p className="text-sm text-white/50">
              No goal yet. A board with a goal shows what it is for and the numbers that say whether
              it is working; a board without one is just a list.
            </p> */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={primaryButtonClass}
                disabled={busy}
                onClick={() => setSettingGoal(true)}
              >
                Set a goal
              </button>
              {unattachedGoals.length > 0 && (
                <>
                  <span className="font-mono text-xs text-white/35">
                    or use one already written
                  </span>
                  <label className="sr-only" htmlFor="board-existing-goal">
                    Existing goal
                  </label>
                  <select
                    id="board-existing-goal"
                    className={`${selectClass} w-auto`}
                    value={existingId}
                    onChange={(e) => setExistingId(e.target.value)}
                  >
                    <option value="">Pick a goal…</option>
                    {unattachedGoals.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.title}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={busy || !existingId}
                    onClick={() =>
                      void mutate(() =>
                        send('/api/admin/boards', 'PATCH', { slug: board.slug, goalId: existingId })
                      ).then(() => setExistingId(''))
                    }
                  >
                    Use this goal
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </section>
    );
  }

  const preview = completionPreview(kpis, cards, columnsById);

  return (
    <div className="space-y-4">
      {editing ? (
        <GoalForm
          goal={goal}
          owners={owners}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={async (values) => {
            await mutate(() => send('/api/admin/goals', 'PATCH', { id: goal.id, ...values }));
            setEditing(false);
          }}
        />
      ) : (
        <section className={raisedCardClass}>
          <SectionTitle
            note={
              rollup.kpis.total > 0
                ? `${rollup.kpis.met} of ${rollup.kpis.total} KPIs met`
                : undefined
            }
          >
            Goal
          </SectionTitle>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="min-w-0 break-words font-primary-semibold text-xl text-[var(--pyre-creme)]">
              {goal.title}
            </h2>
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClass} onClick={() => setEditing(true)}>
                  Edit
                </button>
                <button type="button" className={buttonClass} onClick={() => setDetaching(true)}>
                  Detach
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
              </div>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <GoalStatusBadge status={goal.status} />
            <PaceChip pace={rollup.pace} />
            {goal.owner_email && <QuietChip>{personName(goal.owner_email, people)}</QuietChip>}
            {goal.area && <QuietChip>{goal.area}</QuietChip>}
            {goal.target_date && (
              <QuietChip>
                {formatYmd(goal.target_date)} · {formatDaysLeft(rollup.daysLeft)}
              </QuietChip>
            )}
          </div>

          <div className="mt-3 grid grid-cols-1 gap-4">
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-white/35">
                {board.card_noun}s done
              </p>
              <TaskBar progress={rollup.tasks} />
            </div>

            <div>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <p className="font-mono text-[10px] uppercase tracking-wide text-white/35">KPIs</p>
                {canManage && kpiFormFor === null && (
                  <button
                    type="button"
                    className="font-mono text-[11px] text-white/45 underline hover:text-white/70"
                    onClick={() => setKpiFormFor('new')}
                  >
                    Add a KPI
                  </button>
                )}
              </div>
              {kpis.length === 0 && kpiFormFor === null && (
                <p className="font-mono text-xs text-white/35">
                  No KPIs yet. Without one, “met” is a feeling.
                </p>
              )}
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {kpis.map((kpi) => (
                  <KpiRow
                    key={kpi.id}
                    kpi={kpi}
                    nowIso={nowIso}
                    busy={busy}
                    canManage={canManage}
                    canMeasure={canWorkGoal}
                    onEdit={() => setKpiFormFor(kpi)}
                    onRemove={() => setRemovingKpi(kpi)}
                    onMeasure={(value) =>
                      mutate(() =>
                        send('/api/admin/goal-kpis', 'PATCH', { id: kpi.id, currentValue: value })
                      )
                    }
                  />
                ))}
              </ul>
              {kpiFormFor !== null && (
                <div className="mt-2">
                  <KpiForm
                    kpi={kpiFormFor === 'new' ? undefined : kpiFormFor}
                    busy={busy}
                    onCancel={() => setKpiFormFor(null)}
                    onSave={async (values) => {
                      if (kpiFormFor === 'new') {
                        await mutate(() =>
                          send('/api/admin/goal-kpis', 'POST', { goalId: goal.id, ...values })
                        );
                      } else {
                        await mutate(() =>
                          send('/api/admin/goal-kpis', 'PATCH', { id: kpiFormFor.id, ...values })
                        );
                      }
                      setKpiFormFor(null);
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          {goal.description_md.trim() && (
            <div className="mt-4 border-t border-white/10 pt-3">
              <SopMarkdown content={goal.description_md} />
            </div>
          )}

          {goal.status === 'completed' && (
            <p className="mt-4 border-t border-white/10 pt-3 text-sm text-white/60">
              Completed{goal.completed_by ? ` by ${personName(goal.completed_by, people)}` : ''}
              {goal.completed_at ? ` on ${formatYmd(goal.completed_at.slice(0, 10))}` : ''}.
              {goal.completion_note && (
                <span className="mt-1 block whitespace-pre-wrap text-white/50">
                  {goal.completion_note}
                </span>
              )}
            </p>
          )}
        </section>
      )}

      {completing && (
        <CompleteGoalDialog
          goalTitle={goal.title}
          preview={preview}
          busy={busy}
          onCancel={() => setCompleting(false)}
          onConfirm={(note) => {
            setCompleting(false);
            void mutate(async () => {
              const saved = await send('/api/admin/goals', 'PATCH', {
                id: goal.id,
                status: 'completed',
                completionNote: note || null,
              });
              // Only once it has actually landed — a goal that failed to save
              // does not get a celebration.
              onCompleted();
              return saved;
            });
          }}
        />
      )}

      {removingKpi && (
        <ConfirmDialog
          title={`Remove “${removingKpi.name}”?`}
          body="The KPI and every measurement on it go with it. The goal keeps its tasks and its history."
          confirmLabel="Remove"
          danger
          busy={busy}
          onCancel={() => setRemovingKpi(null)}
          onConfirm={() => {
            const id = removingKpi.id;
            setRemovingKpi(null);
            void mutate(() => send(`/api/admin/goal-kpis?id=${id}`, 'DELETE'));
          }}
        />
      )}

      {detaching && (
        <ConfirmDialog
          title="Detach this goal from the board?"
          body={`"${goal.title}" keeps its KPIs and its history and can be picked up by another board. The ${board.card_noun}s here stop counting toward it.`}
          confirmLabel="Detach"
          busy={busy}
          onCancel={() => setDetaching(false)}
          onConfirm={() => {
            setDetaching(false);
            void mutate(() =>
              send('/api/admin/boards', 'PATCH', { slug: board.slug, goalId: null })
            );
          }}
        />
      )}
    </div>
  );
}
