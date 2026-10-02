// One checklist, shared by everything in the admin that has one: an SOP's
// live run (ChecklistView wraps it in the run's sticky progress header) and a
// board card's checklist field (CardDrawer). It renders a markdown document's
// prose as prose and its task items (`- [ ]`, and `- [!]` for a required
// one) as large tappable rows; what a tap *means* — a row in sop_run_checks,
// an answer on a card — is the caller's, reported through `onToggle`.
//
// Every item is resolved one of two ways: tapping the box completes it, and
// the Skip control beside it marks it skipped — done with, but deliberately
// not done, so the record never leaves anyone wondering whether an item was
// passed over on purpose or never looked at. An item the document marks
// required has no Skip, only a Required tag in its place, and a skipped
// parent leaves its required children open — they have to be done, so the
// checklist stays unfinished until they are. Checking or skipping a parent
// task resolves everything still open under it in one tap; un-resolving
// (tapping a resolved box, or Undo on a skipped row) stays one item at a
// time. Rows can be swiped as well: right completes, left skips. Resolved
// items say who did it and when. An item that links to another checklist
// carries a thin progress bar for that sub-checklist under its text.
//
// Reaching the end — every item resolved, every required one completed —
// pops confetti over the page and calls `onComplete`, once per time the
// checklist gets there. It fires on the same marks the rows draw from, so it
// lands with the tap rather than with the server's answer, and a checklist
// that was already complete when it first rendered is history, not news.
//
// Each task row is memoized — a tap re-renders the rows it changed, not the
// whole document.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { etTime } from '@/lib/client/format';
import {
  type ChecklistMark,
  type ChecklistTask,
  isChecklistComplete,
  parseChecklist,
  subtreeTasks,
} from '@/lib/sops/checklist';
import { type LinkedProgress, type LinkedProgressMap, linkedSopSlugs } from '@/lib/sops/links';
import { type PeopleNames, personName } from '@/lib/sops/names';
import type { CheckItems } from '@/lib/sops/optimistic';
import { type SwipeAction, swipeAction } from '@/lib/sops/swipe';
import { Confetti } from './Confetti';
import { SopMarkdown } from './SopMarkdown';
import { useRowSwipe } from './useRowSwipe';

export type { ChecklistMark };

// Indent per nesting depth (matches the parser's 2-spaces-per-level).
const DEPTH_PAD = ['', 'pl-7', 'pl-14', 'pl-21'];

// No rows share this array, so unchanged rows keep the same reference.
const NO_LINKED: LinkedProgress[] = [];

// The per-row Skip / Undo control: quiet next to the box, but a real tap
// target (staff are on phones).
const skipButtonClass =
  'shrink-0 rounded border border-transparent px-2 py-1.5 font-mono text-[10px] uppercase tracking-wide text-white/40 transition-colors hover:border-white/20 hover:text-white/80 focus-visible:border-white/40 focus-visible:outline-none';

// Sits where Skip sits on an item that can't be skipped, so the control
// column always says what this item's options are.
const requiredTagClass =
  'mt-2 shrink-0 rounded border border-[var(--pyre-gold)]/40 px-2 py-1.5 font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)]/80';

/** The frame an SOP document sits in; a card drawer passes its own. */
const DEFAULT_FRAME = 'rounded border border-white/10 bg-white/5 p-5 sm:p-6';

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
  onSopLink?: (slug: string) => void;
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
    actionAt: (dx) => swipeAction({ checked, skipped, skippable: !task.required }, dx),
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

/** "skipped by Sam · 3:42 PM"; a mark not yet stamped with a person reads as just the time. */
function markLabel(mark: ChecklistMark, people: PeopleNames | undefined): string {
  const when = mark.at ? etTime(mark.at) : '';
  const who = mark.by ? personName(mark.by, people) : '';
  if (!who) return [mark.skipped ? 'skipped' : '', when].filter(Boolean).join(' · ');
  return `${mark.skipped ? 'skipped by ' : ''}${who}${when ? ` · ${when}` : ''}`;
}

export function Checklist({
  content,
  marks,
  people,
  linked,
  locked = false,
  highlight,
  frameClassName = DEFAULT_FRAME,
  onSopLink,
  onToggle,
  onComplete,
}: {
  /** The markdown: prose, `- [ ]` items, and `- [!]` required items. */
  content: string;
  /** Every resolved item — completed or skipped — keyed by item index. */
  marks: ChecklistMark[];
  people?: PeopleNames;
  /** Progress of the checklists this document links to, by slug. */
  linked?: LinkedProgressMap;
  /** The boxes show their state but take no taps (a finished SOP run). */
  locked?: boolean;
  highlight?: string;
  /** The classes of the box the document sits in. */
  frameClassName?: string;
  onSopLink?: (slug: string) => void;
  /**
   * One entry per item the tap covers — a parent tap carries its subtree —
   * each marked skipped or not. `checked: false` un-resolves the one item.
   */
  onToggle: (items: CheckItems, checked: boolean) => void;
  /** Every item is resolved and every required one completed — called once each time it gets there. */
  onComplete?: () => void;
}) {
  const parsed = useMemo(() => parseChecklist(content), [content]);
  const markByIndex = useMemo(() => new Map(marks.map((m) => [m.index, m])), [marks]);
  const complete = useMemo(() => isChecklistComplete(parsed.tasks, marks), [parsed, marks]);

  // One burst (and one onComplete) each time the checklist reaches the end.
  // What is watched is that state, not any id — an SOP's first tap shows an
  // optimistic run whose id arrives later, and swapping it in is not a second
  // completion. `celebrated` starts undefined and is seeded by the first
  // effect, so a checklist already complete on the first render (a reopened
  // page, a card opened after the fact) is remembered rather than announced.
  // Clearing it (Start again, an Undo) puts it back to false, which is what
  // lets the next completion count.
  const [burst, setBurst] = useState(0);
  const celebrated = useRef<boolean | undefined>(undefined);
  const completeAction = useRef(onComplete);
  completeAction.current = onComplete;
  useEffect(() => {
    const was = celebrated.current;
    celebrated.current = complete;
    if (was === undefined || was === complete) return;
    if (complete) {
      setBurst((n) => n + 1);
      completeAction.current?.();
    }
  }, [complete]);

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
  // re-render on each tap); they read the latest tasks and marks from a ref.
  const latest = useRef({ parsed, markByIndex, onToggle });
  latest.current = { parsed, markByIndex, onToggle };

  // Resolving cascades to the still-open subtree (a child already completed
  // or skipped keeps its own record); un-resolving touches only this item.
  // A skip cascade steps over required items — skipping a section can't
  // quietly skip the one thing in it that had to be done — so they stay open
  // and the checklist waits for them.
  const resolve = useCallback((task: ChecklistTask, skipped: boolean) => {
    const { parsed: current, markByIndex: resolved, onToggle: emit } = latest.current;
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
    // The confetti layer sits outside the frame: it is fixed to the viewport,
    // and a child of a spaced stack would take a gap from it.
    <>
      <Confetti burst={burst} />
      <div className={frameClassName}>
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
          const mark = markByIndex.get(task.index);
          const skipped = mark?.skipped === true;
          return (
            <TaskRow
              key={`task-${segment.line}`}
              task={task}
              checked={!!mark && !skipped}
              skipped={skipped}
              locked={locked}
              linked={linkedByTask.get(task.index) ?? NO_LINKED}
              resolvedLabel={mark ? markLabel(mark, people) : null}
              highlight={highlight}
              onSopLink={onSopLink}
              onToggle={handleToggle}
              onSkip={handleSkip}
            />
          );
        })}
      </div>
    </>
  );
}
