// The live checklist for a task-bearing SOP. The document's prose renders as
// usual; its task items render as large tappable rows bound to the shared run.
// There is no separate "run mode" any more: with no run open the rows sit
// unresolved and the first tap starts one (useSopRun owns that logic — this
// component just reports toggles); once a run exists a sticky progress header
// appears with Discard, and un-resolving the last remaining item silently
// discards the run again.
//
// Every item is resolved one of two ways: tapping the box completes it, and
// the Skip control beside it marks it skipped — done with, but deliberately
// not done, so the record never leaves anyone wondering whether an item was
// passed over on purpose or never looked at. An item the document marks
// required (`- [!]`) is the exception: it has no Skip, only a Required tag
// in its place, and a skipped parent leaves its required children open —
// they have to be done, so the run stays unfinished until they are. Resolving the last item finishes
// the run by itself (there is no Finish button, so a finished run never has
// an unaccounted-for item); the finished run then shows ticked and locked,
// with Start again in the header, until someone clears it. Checking or
// skipping a parent task resolves everything still open under it in one tap;
// un-resolving (tapping a resolved box, or Undo on a skipped row) stays one
// item at a time. Resolved items say who did it and when. An item that links
// to another checklist carries a thin progress bar for that sub-checklist
// under its text, so the parent shows where each subtask stands without
// opening it.
//
// Taps are never blocked: SopDocument applies them locally and queues the
// server work, so `busy` only holds Discard while requests are still in
// flight. Each task row is memoized — a tap re-renders the rows it changed,
// not the whole document.
import { memo, useCallback, useMemo, useRef } from 'react';
import type { SopRunCheckRow, SopRunRow } from '@/lib/db';
import { type ChecklistTask, parseChecklist, subtreeTasks } from '@/lib/sops/checklist';
import { type LinkedProgress, type LinkedProgressMap, linkedSopSlugs } from '@/lib/sops/links';
import { type PeopleNames, personName } from '@/lib/sops/names';
import type { CheckItems, RunState } from '@/lib/sops/optimistic';
import type { SwipeAction } from '@/lib/sops/swipe';
import { ConfirmDialog } from './ConfirmDialog';
import { SopMarkdown } from './SopMarkdown';
import { useRowSwipe } from './useRowSwipe';

// Indent per nesting depth (matches the parser's 2-spaces-per-level).
const DEPTH_PAD = ['', 'pl-7', 'pl-14', 'pl-21'];

// Where the progress header pins: under the page nav, or at the top of the
// peek modal's own scroll container. Literal class names, for Tailwind.
const STICKY_TOP = { nav: 'top-14', none: 'top-0' } as const;

// No rows share this array, so unchanged rows keep the same reference.
const NO_LINKED: LinkedProgress[] = [];

const headerButtonClass =
  'px-3 py-1.5 rounded border border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 text-xs font-mono uppercase tracking-wide text-[var(--pyre-gold)] hover:border-[var(--pyre-gold)] transition-colors disabled:opacity-40';

const discardButtonClass =
  'rounded border border-white/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-white/50 transition-colors hover:border-[var(--pyre-red)]/50 hover:text-[var(--pyre-red)] disabled:opacity-40';

// The per-row Skip / Undo control: quiet next to the box, but a real tap
// target (staff are on phones).
const skipButtonClass =
  'shrink-0 rounded border border-transparent px-2 py-1.5 font-mono text-[10px] uppercase tracking-wide text-white/40 transition-colors hover:border-white/20 hover:text-white/80 focus-visible:border-white/40 focus-visible:outline-none';

// Sits where Skip sits on an item that can't be skipped, so the control
// column always says what this item's options are.
const requiredTagClass =
  'mt-2 shrink-0 rounded border border-[var(--pyre-gold)]/40 px-2 py-1.5 font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)]/80';

// Pinned locale + venue time zone: this renders on the server and again on
// the phone, and the two have to agree or React throws the server tree away.
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** The bar under an item that links to a sub-checklist. */
function SubProgress({ progress }: { progress: LinkedProgress }) {
  const full = progress.taskCount > 0 && progress.checked >= progress.taskCount;
  const done = progress.status === 'completed' || (progress.status === 'in_progress' && full);
  const pct =
    progress.taskCount > 0 ? Math.round((progress.checked / progress.taskCount) * 100) : 0;
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div className="h-1.5 w-32 overflow-hidden rounded bg-white/10">
        <div
          className={`h-full transition-all ${done ? 'bg-[var(--pyre-sage)]' : 'bg-[var(--pyre-gold)]'}`}
          style={{ width: `${done ? 100 : pct}%` }}
        />
      </div>
      <span
        className={`font-mono text-[10px] ${done ? 'text-[var(--pyre-sage)]' : 'text-white/40'}`}
      >
        {progress.status === 'completed'
          ? 'Completed'
          : progress.status === 'in_progress'
            ? `${progress.checked} of ${progress.taskCount}`
            : 'Not started'}
      </span>
    </div>
  );
}

// What a swipe in progress promises, drawn in the track the row uncovers as
// it moves. The mark matches the box the swipe will leave behind: a tick for
// completed, a dash for skipped.
const SWIPE_TONE: Record<SwipeAction, { tint: string; text: string; label: string }> = {
  complete: {
    tint: 'bg-[var(--pyre-gold)]/25',
    text: 'text-[var(--pyre-gold)]',
    label: 'Complete',
  },
  skip: { tint: 'bg-white/10', text: 'text-white/70', label: 'Skip' },
  undo: { tint: 'bg-white/10', text: 'text-white/70', label: 'Undo' },
};

function SwipeReveal({
  action,
  armed,
  rightward,
}: {
  /** Null when nothing is being dragged, or the direction does nothing here. */
  action: SwipeAction | null;
  /** Far enough that letting go commits: the track goes to full strength. */
  armed: boolean;
  /** The finger is heading right, so the label sits on the edge being uncovered. */
  rightward: boolean;
}) {
  if (!action) return null;
  const tone = SWIPE_TONE[action];
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 transition-opacity ${tone.tint} ${
        armed ? 'opacity-100' : 'opacity-50'
      }`}
    >
      <div
        className={`absolute inset-y-0 flex items-center gap-1.5 px-3 font-mono text-[10px] uppercase tracking-wide ${tone.text} ${
          rightward ? 'left-0' : 'right-0'
        }`}
      >
        <svg
          viewBox="0 0 12 12"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={action === 'undo' ? 1.75 : 2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          role="presentation"
        >
          {action === 'complete' && <path d="M2 6.5 4.8 9.2 10 3.2" />}
          {action === 'skip' && <path d="M2.5 6h7" />}
          {action === 'undo' && (
            <>
              <path d="M4.5 3.5 2 6l2.5 2.5" />
              <path d="M2 6h5a2.5 2.5 0 1 1 0 5H5" />
            </>
          )}
        </svg>
        {tone.label}
      </div>
    </div>
  );
}

const TaskRow = memo(function TaskRow({
  task,
  checked,
  skipped,
  resolvedLabel,
  linked,
  locked,
  highlight,
  onSopLink,
  onToggle,
  onSkip,
}: {
  task: ChecklistTask;
  /** Completed. */
  checked: boolean;
  /** Explicitly skipped — resolved, but not done. */
  skipped: boolean;
  /** The run is finished: the box shows its state but takes no taps. */
  locked: boolean;
  /** "who · when" (or "skipped by who · when") for a resolved item, precomputed so the row's props stay flat. */
  resolvedLabel: string | null;
  /** Progress of the sub-checklists this item links to (usually none or one). */
  linked: LinkedProgress[];
  highlight?: string;
  onSopLink: (slug: string) => void;
  /** The box: complete the item (true) or un-resolve it (false). */
  onToggle: (task: ChecklistTask, nextChecked: boolean) => void;
  /** The side control: skip the item (true) or undo a skip (false). */
  onSkip: (task: ChecklistTask, nextSkipped: boolean) => void;
}) {
  const resolved = checked || skipped;
  // Swiping the row does what the two controls below do, without having to
  // aim: right completes the item, left skips it, and on a row already
  // resolved the other direction un-resolves it. Required items take the
  // complete swipe only, matching their missing Skip control.
  const swipe = useRowSwipe({
    enabled: !locked,
    state: { checked, skipped, skippable: !task.required },
    onAction: (action) => {
      if (action === 'complete') onToggle(task, true);
      else if (action === 'skip') onSkip(task, true);
      else onToggle(task, false);
    },
  });
  return (
    <div
      className={`${DEPTH_PAD[task.depth] ?? ''} ${task.depth > 0 ? 'border-l border-white/10' : ''}`}
    >
      <div
        className={`group relative -mx-2 overflow-hidden rounded-lg transition-colors ${
          locked ? '' : 'touch-pan-y hover:bg-white/5'
        }`}
        {...swipe.handlers}
      >
        <SwipeReveal action={swipe.action} armed={swipe.armed} rightward={swipe.dx > 0} />
        {/* The row rides over the reveal; while it is moving it needs a back
            of its own so the track never shows through the text. */}
        <div
          className={`flex items-start gap-1 px-2 ${
            swipe.dragging
              ? 'select-none bg-[var(--pyre-black)]'
              : 'transition-transform duration-200 motion-reduce:transition-none'
          }`}
          style={swipe.dx === 0 ? undefined : { transform: `translateX(${swipe.dx}px)` }}
        >
          {/* The whole label is the tap target — staff are on phones with wet
            hands, so it spans the box, the text and the padding alike. The
            Skip control sits outside it so a tap there never reaches the box. */}
          <label
            className={`flex min-w-0 flex-1 items-start gap-3 py-2.5 ${
              locked ? '' : 'cursor-pointer active:bg-white/10'
            }`}
          >
            <input
              type="checkbox"
              className="peer sr-only"
              checked={resolved}
              disabled={locked}
              onChange={(e) => onToggle(task, e.target.checked)}
            />
            <span
              aria-hidden="true"
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--pyre-gold)]/50 ${
                checked
                  ? 'border-[var(--pyre-gold)] bg-[var(--pyre-gold)]'
                  : skipped
                    ? 'border-dashed border-white/40 bg-white/5'
                    : task.required
                      ? 'border-[var(--pyre-gold)]/60 group-hover:border-[var(--pyre-gold)]'
                      : 'border-white/30 group-hover:border-white/50'
              }`}
            >
              <svg
                viewBox="0 0 12 12"
                className={`h-3.5 w-3.5 transition-opacity ${resolved ? 'opacity-100' : 'opacity-0'}`}
                fill="none"
                stroke={checked ? 'var(--pyre-black)' : 'rgba(255,255,255,0.6)'}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                role="presentation"
              >
                {/* A tick for completed, a dash for skipped. */}
                {skipped ? <path d="M2.5 6h7" /> : <path d="M2 6.5 4.8 9.2 10 3.2" />}
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              {/* line-through lives on its own wrapper so the attribution
                line below doesn't get struck with the task text. */}
              <div
                className={`text-sm leading-snug [&_p]:my-0 ${
                  checked
                    ? 'text-white/40 line-through'
                    : skipped
                      ? 'text-white/40 italic'
                      : 'text-white/85'
                }`}
              >
                <SopMarkdown content={task.text} highlight={highlight} onSopLink={onSopLink} />
              </div>
              {linked.map((progress) => (
                <SubProgress key={progress.slug} progress={progress} />
              ))}
              {resolvedLabel && (
                <div className="mt-0.5 font-mono text-[10px] text-white/35">{resolvedLabel}</div>
              )}
            </div>
          </label>
          {/* Skip is for an item that can't or shouldn't be done this time;
            Undo puts a skipped item back. A completed item has no side
            control — tapping its box un-resolves it. A required item has no
            Skip either: the only way past it is to do it. (Undo still shows
            on one already skipped — the document may have been marked
            required after the skip was recorded.) */}
          {!locked &&
            !checked &&
            (task.required && !skipped ? (
              <span className={requiredTagClass}>Required</span>
            ) : (
              <button
                type="button"
                className={`${skipButtonClass} mt-2`}
                onClick={() => onSkip(task, !skipped)}
              >
                {skipped ? 'Undo' : 'Skip'}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
});

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
  const checkByIndex = useMemo(() => new Map(checks.map((c) => [c.item_index, c])), [checks]);
  const done = checks.length;
  const skippedCount = useMemo(() => checks.filter((c) => c.skipped).length, [checks]);
  const total = run?.task_count ?? parsed.tasks.length;
  // Required items still waiting to be completed — the header names them as a
  // count so nobody is left wondering why a checklist won't finish.
  const requiredLeft = useMemo(
    () =>
      parsed.tasks.filter((task) => {
        if (!task.required) return false;
        const check = checkByIndex.get(task.index);
        return !check || check.skipped;
      }).length,
    [parsed, checkByIndex]
  );
  const finished = run !== null && run.status !== 'in_progress';
  const allDone = finished || (run !== null && total > 0 && done >= total);

  // Sub-checklist progress per task index, for the items that link to one.
  const linkedByTask = useMemo(() => {
    const map = new Map<number, LinkedProgress[]>();
    if (!linked) return map;
    for (const task of parsed.tasks) {
      const entries = linkedSopSlugs(task.text).flatMap((slug) => linked[slug] ?? []);
      if (entries.length > 0) map.set(task.index, entries);
    }
    return map;
  }, [parsed, linked]);

  // One stable handler pair for every row (so the memoized rows don't all
  // re-render on each tap); they read the latest tasks and checks from a ref.
  const latest = useRef({ parsed, checkByIndex, onToggle });
  latest.current = { parsed, checkByIndex, onToggle };

  // Resolving cascades to the still-open subtree (a child already completed
  // or skipped keeps its own record); un-resolving touches only this item.
  // A skip cascade steps over required items — skipping a section can't
  // quietly skip the one thing in it that had to be done — so they stay open
  // and the run waits for them.
  const resolve = useCallback((task: ChecklistTask, skipped: boolean) => {
    const { parsed: current, checkByIndex: resolved, onToggle: emit } = latest.current;
    const items = subtreeTasks(current.tasks, task.index)
      .filter((t) => !(skipped && t.required))
      .filter((t) => t.index === task.index || !resolved.has(t.index))
      .map((t) => ({ itemIndex: t.index, itemText: t.text, skipped }));
    if (items.length === 0) return;
    emit(items, true);
  }, []);
  const unresolve = useCallback((task: ChecklistTask) => {
    latest.current.onToggle([{ itemIndex: task.index, itemText: task.text }], false);
  }, []);

  const handleToggle = useCallback(
    (task: ChecklistTask, nextChecked: boolean) => {
      if (nextChecked) resolve(task, false);
      else unresolve(task);
    },
    [resolve, unresolve]
  );
  const handleSkip = useCallback(
    (task: ChecklistTask, nextSkipped: boolean) => {
      if (nextSkipped) resolve(task, true);
      else unresolve(task);
    },
    [resolve, unresolve]
  );

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
                ? `finished by ${personName(run.ended_by, people)} at ${formatTime(run.ended_at)}`
                : `started by ${personName(run.started_by, people)} at ${formatTime(run.started_at)}`}
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
                <button
                  type="button"
                  className={discardButtonClass}
                  disabled={busy}
                  onClick={onDiscard}
                >
                  Discard
                </button>
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

      <div className="rounded border border-white/10 bg-white/5 p-5 sm:p-6">
        {parsed.segments.map((segment) => {
          if (segment.kind === 'markdown') {
            // Each prose chunk renders as its own SopMarkdown, which zeroes a
            // leading heading's top margin (first:mt-0) — so section headers
            // between task groups need their breathing room restored here.
            const startsWithHeading = /^#{1,6}\s/.test(segment.content.trimStart());
            return (
              <div
                key={`md-${segment.line}`}
                className={startsWithHeading ? 'pt-8 first:pt-0' : ''}
              >
                <SopMarkdown
                  content={segment.content}
                  highlight={highlight}
                  onSopLink={onSopLink}
                />
              </div>
            );
          }
          const { task } = segment;
          const check = checkByIndex.get(task.index);
          const skipped = check?.skipped === true;
          return (
            <TaskRow
              key={`task-${segment.line}`}
              task={task}
              checked={!!check && !skipped}
              skipped={skipped}
              locked={finished}
              linked={linkedByTask.get(task.index) ?? NO_LINKED}
              resolvedLabel={
                check
                  ? `${skipped ? 'skipped by ' : ''}${personName(check.checked_by, people)} · ${formatTime(check.checked_at)}`
                  : null
              }
              highlight={highlight}
              onSopLink={onSopLink}
              onToggle={handleToggle}
              onSkip={handleSkip}
            />
          );
        })}
      </div>
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
