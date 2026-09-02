// The live checklist for a task-bearing SOP. The document's prose renders as
// usual; its task items render as large tappable rows bound to the shared run.
// There is no separate "run mode" any more: with no run open the rows sit
// unchecked and the first tap starts one (SopDocument owns that logic — this
// component just reports toggles); once a run exists a sticky progress header
// appears with Finish and Discard, and unchecking the last remaining item
// silently discards the run again. Checking a parent task checks everything
// nested under it in one tap; unchecking stays one item at a time. Checked
// items say who ticked them and when.
//
// Taps are never blocked: SopDocument applies them locally and queues the
// server work, so `busy` only holds Finish and Discard while requests are
// still in flight. Each task row is memoized — a tap re-renders the rows it
// changed, not the whole document.
import { memo, useCallback, useMemo, useRef } from 'react';
import type { SopRunCheckRow, SopRunRow } from '@/lib/db';
import { type ChecklistTask, parseChecklist, subtreeTasks } from '@/lib/sops/checklist';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { SopMarkdown } from './SopMarkdown';

// Indent per nesting depth (matches the parser's 2-spaces-per-level).
const DEPTH_PAD = ['', 'pl-7', 'pl-14', 'pl-21'];

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

const TaskRow = memo(function TaskRow({
  task,
  checked,
  checkedLabel,
  highlight,
  onSopLink,
  onToggle,
}: {
  task: ChecklistTask;
  checked: boolean;
  /** "who · when" for a checked item, precomputed so the row's props stay flat. */
  checkedLabel: string | null;
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
      <label className="group -mx-2 flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-white/5 active:bg-white/10">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
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
  currentVersion,
  busy,
  highlight,
  onSopLink,
  onToggle,
  onFinish,
  onDiscard,
}: {
  /** Run snapshot when a run is open, otherwise the current document. */
  content: string;
  run: SopRunRow | null;
  checks: SopRunCheckRow[];
  people?: PeopleNames;
  currentVersion: number;
  /** Requests in flight — holds Finish and Discard, never the boxes. */
  busy: boolean;
  highlight?: string;
  onSopLink: (slug: string) => void;
  /** One entry per item the toggle covers — a parent tap carries its subtree. */
  onToggle: (items: { itemIndex: number; itemText: string }[], checked: boolean) => void;
  onFinish: () => void;
  onDiscard: () => void;
}) {
  const parsed = useMemo(() => parseChecklist(content), [content]);
  const checkByIndex = useMemo(() => new Map(checks.map((c) => [c.item_index, c])), [checks]);
  const done = checks.length;
  const total = run?.task_count ?? parsed.tasks.length;
  const allDone = run !== null && total > 0 && done >= total;

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
          className={`sticky top-14 z-30 space-y-2 rounded-lg border bg-[var(--pyre-black)] p-4 ${
            allDone ? 'border-[var(--pyre-sage)]/60' : 'border-[var(--pyre-gold)]/40'
          }`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`font-mono text-xs uppercase tracking-wide ${
                allDone ? 'text-[var(--pyre-sage)]' : 'text-[var(--pyre-gold)]'
              }`}
            >
              {allDone ? 'All items done' : 'Checklist in progress'}
            </span>
            <span className="font-mono text-xs text-white/60">
              {done} of {total}
            </span>
            <span className="font-mono text-[10px] text-white/40">
              started by {personName(run.started_by, people)} at {formatTime(run.started_at)}
            </span>
            <span className="ml-auto flex gap-2">
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
