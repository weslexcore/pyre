// The live checklist for a task-bearing SOP: the shared Checklist (which
// draws the document, its rows, skips, required items, swipes and the
// confetti) bound to the shared run. There is no separate "run mode" any
// more: with no run open the rows sit unresolved and the first tap starts one
// (useSopRun owns that logic — this component just reports toggles); once a
// run exists a sticky progress header appears with Discard, and un-resolving
// the last remaining item silently discards the run again.
//
// Resolving the last item finishes the run by itself (there is no Finish
// button, so a finished run never has an unaccounted-for item); the finished
// run then shows ticked and locked, with Start again in the header, until
// someone clears it.
//
// While a run is going, Outstanding only cuts the document down to the items
// still to do, so a long checklist reads as what's left rather than a scroll
// past everything already ticked.
//
// Taps are never blocked: SopDocument applies them locally and queues the
// server work, so `busy` only holds Discard while requests are still in
// flight.
import { useMemo, useState } from 'react';
import { etTime } from '@/lib/client/format';
import type { SopRunCheckRow, SopRunRow } from '@/lib/db';
import { parseChecklist } from '@/lib/sops/checklist';
import type { LinkedProgressMap } from '@/lib/sops/links';
import { type PeopleNames, personName } from '@/lib/sops/names';
import type { CheckItems, RunState } from '@/lib/sops/optimistic';
import { Checklist, type ChecklistMark } from './Checklist';
import { ConfirmDialog } from './ConfirmDialog';

// Where the progress header pins: under the page nav, or at the top of the
// peek modal's own scroll container. Literal class names, for Tailwind.
const STICKY_TOP = { nav: 'top-14', none: 'top-0' } as const;

const headerButtonClass =
  'px-3 py-1.5 rounded border border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 text-xs font-mono uppercase tracking-wide text-[var(--pyre-gold)] hover:border-[var(--pyre-gold)] transition-colors disabled:opacity-40';

// Outstanding only, while off: quiet, like Discard, but without the red.
const filterOffButtonClass =
  'rounded border border-white/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-white/50 transition-colors hover:border-white/30 hover:text-white/80';

const discardButtonClass =
  'rounded border border-white/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-white/50 transition-colors hover:border-[var(--pyre-red)]/50 hover:text-[var(--pyre-red)] disabled:opacity-40';

export function ChecklistView({
  content,
  run,
  checks,
  people,
  linked,
  currentVersion,
  busy,
  highlight,
  headerOffset = 'nav',
  onSopLink,
  onToggle,
  onDiscard,
  onStartAgain,
}: {
  /** Run snapshot when a run is open, otherwise the current document. */
  content: string;
  /** The open run, or a finished one still on screen (status !== in_progress). */
  run: SopRunRow | null;
  /** Every resolved item — completed or skipped — of the run. */
  checks: SopRunCheckRow[];
  people?: PeopleNames;
  /** Progress of the checklists this document links to, by slug. */
  linked?: LinkedProgressMap;
  currentVersion: number;
  /** Requests in flight — holds Discard, never the boxes. */
  busy: boolean;
  highlight?: string;
  /** What the sticky progress header pins under: the page nav, or nothing (modal). */
  headerOffset?: keyof typeof STICKY_TOP;
  onSopLink: (slug: string) => void;
  /**
   * One entry per item the tap covers — a parent tap carries its subtree —
   * each marked skipped or not. `checked: false` un-resolves the one item.
   */
  onToggle: (items: CheckItems, checked: boolean) => void;
  onDiscard: () => void;
  /** Clears a finished run off the screen so the next tap starts a new one. */
  onStartAgain?: () => void;
}) {
  const parsed = useMemo(() => parseChecklist(content), [content]);
  const marks = useMemo<ChecklistMark[]>(
    () =>
      checks.map((check) => ({
        index: check.item_index,
        skipped: check.skipped,
        by: check.checked_by,
        at: check.checked_at,
      })),
    [checks]
  );
  const done = checks.length;
  const skippedCount = useMemo(() => checks.filter((c) => c.skipped).length, [checks]);
  const total = run?.task_count ?? parsed.tasks.length;
  // Required items still waiting to be completed — the header names them as a
  // count so nobody is left wondering why a checklist won't finish.
  const requiredLeft = useMemo(() => {
    const byIndex = new Map(checks.map((c) => [c.item_index, c]));
    return parsed.tasks.filter((task) => {
      if (!task.required) return false;
      const check = byIndex.get(task.index);
      return !check || check.skipped;
    }).length;
  }, [parsed, checks]);
  const finished = run !== null && run.status !== 'in_progress';
  // Only means something mid-run: before the first tap everything is
  // outstanding, and a finished run has nothing left.
  const [outstandingOnly, setOutstandingOnly] = useState(false);
  const filtering = outstandingOnly && run !== null && !finished;
  const allDone = finished || (run !== null && total > 0 && done >= total);

  return (
    <div className="space-y-4">
      {run && (
        <div
          className={`sticky ${STICKY_TOP[headerOffset]} z-30 space-y-2 rounded-lg border bg-[var(--pyre-black)] p-4 ${
            allDone ? 'border-[var(--pyre-sage)]/60' : 'border-[var(--pyre-gold)]/40'
          }`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`font-mono text-xs uppercase tracking-wide ${
                allDone ? 'text-[var(--pyre-sage)]' : 'text-[var(--pyre-gold)]'
              }`}
            >
              {finished ? 'Completed' : allDone ? 'All items done' : 'Checklist in progress'}
            </span>
            <span className="font-mono text-xs text-white/60">
              {done} of {total}
              {skippedCount > 0 && ` · ${skippedCount} skipped`}
            </span>
            <span className="font-mono text-[10px] text-white/40">
              {finished && run.ended_by && run.ended_at
                ? `finished by ${personName(run.ended_by, people)} at ${etTime(run.ended_at)}`
                : `started by ${personName(run.started_by, people)} at ${etTime(run.started_at)}`}
            </span>
            <span className="ml-auto flex gap-2">
              {finished ? (
                <button
                  type="button"
                  className={headerButtonClass}
                  disabled={busy}
                  onClick={onStartAgain}
                >
                  Start again
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className={filtering ? headerButtonClass : filterOffButtonClass}
                    aria-pressed={filtering}
                    onClick={() => setOutstandingOnly((on) => !on)}
                  >
                    Outstanding only
                  </button>
                  <button
                    type="button"
                    className={discardButtonClass}
                    disabled={busy}
                    onClick={onDiscard}
                  >
                    Discard
                  </button>
                </>
              )}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded bg-white/10">
            <div
              className={`h-full transition-all ${
                allDone ? 'bg-[var(--pyre-sage)]' : 'bg-[var(--pyre-gold)]'
              }`}
              style={{ width: `${total > 0 ? Math.round((done / total) * 100) : 0}%` }}
            />
          </div>
          {!allDone && (
            <p className="font-mono text-[10px] text-white/40">
              Check off or skip every item — the checklist finishes on its own.
              {requiredLeft > 0 &&
                ` ${requiredLeft} required item${requiredLeft === 1 ? '' : 's'} must be checked off.`}
              {/* The swipe is worth pointing at, but only where there is a
                    finger to do it with. */}
              <span className="touch-only">
                {' '}
                Or swipe an item right to check it off, left to skip.
              </span>
            </p>
          )}
          {run.sop_version !== currentVersion && (
            <p className="font-mono text-[10px] text-white/40">
              Showing v{run.sop_version}, the version this run started with (the document has since
              changed).
            </p>
          )}
        </div>
      )}

      <Checklist
        content={content}
        marks={marks}
        people={people}
        linked={linked}
        locked={finished}
        outstandingOnly={filtering}
        highlight={highlight}
        onSopLink={onSopLink}
        onToggle={onToggle}
      />
    </div>
  );
}

/**
 * The confirm step before a Discard that erases resolved items — the same
 * words on the page and in the peek modal. (Discarding an empty run needs no
 * confirmation; useSopRun sends that straight through.)
 */
export function ChecklistConfirmDialog({
  runData,
  busy,
  onConfirm,
  onCancel,
}: {
  runData: RunState;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const done = runData.checks.length;
  return (
    <ConfirmDialog
      title="Discard checklist?"
      body={`Nothing is saved — the ${done} item${done === 1 ? '' : 's'} already checked off or skipped will be erased.`}
      confirmLabel="Discard"
      danger
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
