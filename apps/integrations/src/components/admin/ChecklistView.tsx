// The live checklist for a task-bearing SOP. The document's prose renders as
// usual; its task items render as large tappable rows bound to the shared run.
// There is no separate "run mode" any more: with no run open the rows sit
// unchecked and the first tap starts one (useSopRun owns that logic — this
// component just reports toggles); once a run exists a sticky progress header
// appears with Finish and Discard, and unchecking the last remaining item
// silently discards the run again. Ticking the last item finishes the run by
// itself; the finished run then shows ticked and locked, with Start again in
// the header, until someone clears it. Checking a parent task checks everything
// nested under it in one tap; unchecking stays one item at a time. Checked
// items say who ticked them and when. An item that links to another checklist
// carries a thin progress bar for that sub-checklist under its text, so the
// parent shows where each subtask stands without opening it.
//
// Taps are never blocked: SopDocument applies them locally and queues the
// server work, so `busy` only holds Finish and Discard while requests are
// still in flight. Each task row is memoized — a tap re-renders the rows it
// changed, not the whole document.
import { memo, useCallback, useMemo, useRef } from 'react';
import type { SopRunCheckRow, SopRunRow } from '@/lib/db';
import { type ChecklistTask, parseChecklist, subtreeTasks } from '@/lib/sops/checklist';
import { type LinkedProgress, type LinkedProgressMap, linkedSopSlugs } from '@/lib/sops/links';
import { type PeopleNames, personName } from '@/lib/sops/names';
import type { RunState } from '@/lib/sops/optimistic';
import { ConfirmDialog } from './ConfirmDialog';
import { SopMarkdown } from './SopMarkdown';

// Indent per nesting depth (matches the parser's 2-spaces-per-level).
const DEPTH_PAD = ['', 'pl-7', 'pl-14', 'pl-21'];

// Where the progress header pins: under the page nav, or at the top of the
// peek modal's own scroll container. Literal class names, for Tailwind.
const STICKY_TOP = { nav: 'top-14', none: 'top-0' } as const;

// No rows share this array, so unchanged rows keep the same reference.
const NO_LINKED: LinkedProgress[] = [];

const headerButtonClass =
  'px-3 py-1.5 rounded border border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 text-xs font-mono uppercase tracking-wide text-[var(--pyre-gold)] hover:border-[var(--pyre-gold)] transition-colors disabled:opacity-40';

// When everything is checked, Finish is the one thing left to do — solid gold.
const finishDoneClass =
  'px-4 py-1.5 rounded border border-[var(--pyre-gold)] bg-[var(--pyre-gold)] text-xs font-mono uppercase tracking-wide text-[var(--pyre-black)] hover:bg-[var(--pyre-creme)] hover:border-[var(--pyre-creme)] transition-colors disabled:opacity-40';

const discardButtonClass =
  'rounded border border-white/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-white/50 transition-colors hover:border-[var(--pyre-red)]/50 hover:text-[var(--pyre-red)] disabled:opacity-40';

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

const TaskRow = memo(function TaskRow({
  task,
  checked,
  checkedLabel,
  linked,
  locked,
  highlight,
  onSopLink,
  onToggle,
}: {
  task: ChecklistTask;
  checked: boolean;
  /** The run is finished: the box shows its state but takes no taps. */
  locked: boolean;
  /** "who · when" for a checked item, precomputed so the row's props stay flat. */
  checkedLabel: string | null;
  /** Progress of the sub-checklists this item links to (usually none or one). */
  linked: LinkedProgress[];
  highlight?: string;
  onSopLink: (slug: string) => void;
  onToggle: (task: ChecklistTask, nextChecked: boolean) => void;
}) {
  return (
    <div
      className={`${DEPTH_PAD[task.depth] ?? ''} ${task.depth > 0 ? 'border-l border-white/10' : ''}`}
    >
      {/* The whole row is the tap target — staff are on phones with
          wet hands, so the label spans text and padding alike. */}
      <label
        className={`group -mx-2 flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors ${
          locked ? '' : 'cursor-pointer hover:bg-white/5 active:bg-white/10'
        }`}
      >
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={locked}
          onChange={(e) => onToggle(task, e.target.checked)}
        />
        <span
          aria-hidden="true"
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--pyre-gold)]/50 ${
            checked
              ? 'border-[var(--pyre-gold)] bg-[var(--pyre-gold)]'
              : 'border-white/30 group-hover:border-white/50'
          }`}
        >
          <svg
            viewBox="0 0 12 12"
            className={`h-3.5 w-3.5 transition-opacity ${checked ? 'opacity-100' : 'opacity-0'}`}
            fill="none"
            stroke="var(--pyre-black)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            role="presentation"
          >
            <path d="M2 6.5 4.8 9.2 10 3.2" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          {/* line-through lives on its own wrapper so the attribution
              line below doesn't get struck with the task text. */}
          <div
            className={`text-sm leading-snug [&_p]:my-0 ${
              checked ? 'text-white/40 line-through' : 'text-white/85'
            }`}
          >
            <SopMarkdown content={task.text} highlight={highlight} onSopLink={onSopLink} />
          </div>
          {linked.map((progress) => (
            <SubProgress key={progress.slug} progress={progress} />
          ))}
          {checkedLabel && (
            <div className="mt-0.5 font-mono text-[10px] text-white/35">{checkedLabel}</div>
          )}
        </div>
      </label>
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
  onFinish,
  onDiscard,
  onStartAgain,
}: {
  /** Run snapshot when a run is open, otherwise the current document. */
  content: string;
  /** The open run, or a finished one still on screen (status !== in_progress). */
  run: SopRunRow | null;
  checks: SopRunCheckRow[];
  people?: PeopleNames;
  /** Progress of the checklists this document links to, by slug. */
  linked?: LinkedProgressMap;
  currentVersion: number;
  /** Requests in flight — holds Finish and Discard, never the boxes. */
  busy: boolean;
  highlight?: string;
  /** What the sticky progress header pins under: the page nav, or nothing (modal). */
  headerOffset?: keyof typeof STICKY_TOP;
  onSopLink: (slug: string) => void;
  /** One entry per item the toggle covers — a parent tap carries its subtree. */
  onToggle: (items: { itemIndex: number; itemText: string }[], checked: boolean) => void;
  onFinish: () => void;
  onDiscard: () => void;
  /** Clears a finished run off the screen so the next tap starts a new one. */
  onStartAgain?: () => void;
}) {
  const parsed = useMemo(() => parseChecklist(content), [content]);
  const checkByIndex = useMemo(() => new Map(checks.map((c) => [c.item_index, c])), [checks]);
  const done = checks.length;
  const total = run?.task_count ?? parsed.tasks.length;
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

  // One stable toggle handler for every row (so the memoized rows don't all
  // re-render on each tap); it reads the latest tasks and checks from a ref.
  const latest = useRef({ parsed, checkByIndex, onToggle });
  latest.current = { parsed, checkByIndex, onToggle };
  const handleToggle = useCallback((task: ChecklistTask, nextChecked: boolean) => {
    const { parsed: current, checkByIndex: checked, onToggle: emit } = latest.current;
    // Checking cascades to the not-yet-checked subtree; unchecking touches
    // only this item.
    const items = nextChecked
      ? subtreeTasks(current.tasks, task.index)
          .filter((t) => t.index === task.index || !checked.has(t.index))
          .map((t) => ({ itemIndex: t.index, itemText: t.text }))
      : [{ itemIndex: task.index, itemText: task.text }];
    emit(items, nextChecked);
  }, []);

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
                <>
                  <button
                    type="button"
                    className={allDone ? finishDoneClass : headerButtonClass}
                    disabled={busy}
                    onClick={onFinish}
                  >
                    Finish
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
          return (
            <TaskRow
              key={`task-${segment.line}`}
              task={task}
              checked={!!check}
              locked={finished}
              linked={linkedByTask.get(task.index) ?? NO_LINKED}
              checkedLabel={
                check
                  ? `${personName(check.checked_by, people)} · ${formatTime(check.checked_at)}`
                  : null
              }
              highlight={highlight}
              onSopLink={onSopLink}
              onToggle={handleToggle}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * The confirm step before a Finish that skips items or a Discard that erases
 * checks — the same words on the page and in the peek modal.
 */
export function ChecklistConfirmDialog({
  action,
  runData,
  busy,
  onConfirm,
  onCancel,
}: {
  action: 'complete' | 'discard';
  runData: RunState;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const left = runData.run.task_count - runData.checks.length;
  const done = runData.checks.length;
  return (
    <ConfirmDialog
      title={action === 'complete' ? 'Finish checklist?' : 'Discard checklist?'}
      body={
        action === 'complete'
          ? `${left} item${left === 1 ? '' : 's'} unchecked — the record will show what was skipped.`
          : `Nothing is saved — the ${done} item${done === 1 ? '' : 's'} already checked off will be erased.`
      }
      confirmLabel={action === 'complete' ? 'Finish' : 'Discard'}
      danger={action === 'discard'}
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
