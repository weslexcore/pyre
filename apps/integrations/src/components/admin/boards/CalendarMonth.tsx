// The month, drawn. Shared by one board's calendar and the cross-board one,
// so both read the same whatever they are showing.
//
// Two layouts off one list of entries. On a desk it is a Sunday-start month
// grid. On a phone it is an agenda — the grid's
// seven columns mean either a sideways scroll or cells too narrow to read,
// and this admin disables pinch zoom precisely so nobody has to fight that.
// Both render and Tailwind picks; a matchMedia would flash the wrong one
// through hydration, and the entry list is small enough that the second
// render costs nothing.
//
// An entry can also be dragged onto another day, which moves whichever date
// put it there — a due date, or the board field the entry came from. Drag is
// the grid's alone: the agenda has no days to aim at, and on a phone the
// date lives one tap away in the drawer.
//
// It fetches nothing and knows nothing about boards: entries in, clicks out.

import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import {
  addMonths,
  type CalendarEntry,
  type CalendarEntryKind,
  entriesByDate,
  formatEntryTime,
  formatMonth,
  monthEndOf,
  monthGridRange,
  monthStartOf,
  movePatch,
  weeksOf,
} from '@/lib/boards/calendar';
import { formatYmd } from '../goalsUi';
import { filterChipClass, toolbarCaptionClass } from '../scheduleUi';
import {
  DndContext,
  type DragEndEvent,
  DraggableEntry,
  DragOverlay,
  type DragStartEvent,
  DroppableDay,
  dayCollisions,
  useBoardSensors,
} from './dnd';

const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

// Sunday first, so a weekend sits together at the end of a row instead of
// being split across two.
const WEEKDAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Sage for a thing that happens, gold for a thing that is owed, creme for a
 * horizon. The first two already mean that across this admin — the schedule's
 * coverage blocks and the due chip — so the calendar teaches nobody a second
 * vocabulary. A goal's target date is dashed, the way the schedule draws a
 * week that has not locked: a date to steer by, not an appointment.
 */
const ENTRY_TONE: Record<CalendarEntryKind, string> = {
  field: 'border-[var(--pyre-sage)]/60 bg-[var(--pyre-sage)]/15',
  due: 'border-[var(--pyre-gold)]/70 bg-[var(--pyre-gold)]/15',
  goal: 'border-dashed border-[var(--pyre-creme)]/50 bg-white/5',
};

const OVERDUE_TONE = 'border-[var(--pyre-red)]/70 bg-[var(--pyre-red)]/15';
const FINISHED_TONE = 'border-white/15 bg-white/5 opacity-50';

function toneOf(entry: CalendarEntry, today: string): string {
  if (entry.finished) return FINISHED_TONE;
  // A due date in the past is the one thing on this calendar that should
  // shout; everything else is told by where it sits.
  if (entry.kind === 'due' && entry.date < today) return OVERDUE_TONE;
  return ENTRY_TONE[entry.kind];
}

/** The whole of an entry, for the hover title and the phone's second line. */
function describe(entry: CalendarEntry): string {
  const time = formatEntryTime(entry);
  return [time, entry.detail, entry.label, entry.boardName].filter((part) => part).join(' · ');
}

export interface CalendarMonthProps {
  entries: CalendarEntry[];
  monthStart: string;
  onMonthChange: (monthStart: string) => void;
  /** Today in America/New_York, from the server, so clock skew can't recolour. */
  today: string;
  /** Round gold filter chips the caller owns (boards, kinds, finished). */
  chips?: ReactNode;
  /** Extra legend items — the per-board swatches on the cross-board view. */
  legend?: ReactNode;
  /** A per-board accent stripe on the cross-board view. */
  colorOf?: (entry: CalendarEntry) => string | undefined;
  /** Given, a click is handled here instead of following the link. */
  onSelect?: (entry: CalendarEntry) => void;
  /**
   * Given, an entry can be dragged onto another day. The caller writes it —
   * movePatch says what to write — and is expected to show the move at once.
   */
  onMove?: (entry: CalendarEntry, date: string) => void;
  /** A revalidation behind a painted month. */
  refreshing?: boolean;
  /** What to say when the month is empty — the board's own words. */
  emptyNote?: string;
}

export function CalendarMonth({
  entries,
  monthStart,
  onMonthChange,
  today,
  chips,
  legend,
  colorOf,
  onSelect,
  onMove,
  refreshing = false,
  emptyNote = 'Nothing dated this month.',
}: CalendarMonthProps) {
  // Days behind us are noise on a calendar read to find out what is coming,
  // so the agenda starts at today. Deliberately not persisted: every visit
  // starts looking forward.
  const [showPast, setShowPast] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const sensors = useBoardSensors();

  const { gridStart, gridEnd } = useMemo(() => monthGridRange(monthStart), [monthStart]);
  const weeks = useMemo(() => weeksOf(gridStart, gridEnd), [gridStart, gridEnd]);
  const byDate = useMemo(() => entriesByDate(entries), [entries]);

  const monthIsPast = monthEndOf(monthStart) < today;
  const agendaFrom = showPast || monthIsPast ? gridStart : today;
  const agendaDays = useMemo(
    () => [...byDate.keys()].filter((date) => date >= agendaFrom).sort(),
    [byDate, agendaFrom]
  );
  const hiddenPast = byDate.size - agendaDays.length;

  // A goal's target date is not a card patch, so a goal entry stays put.
  const canMove = (entry: CalendarEntry) => !!onMove && movePatch(entry, entry.date) !== null;
  const draggingEntry = entries.find((entry) => entry.id === draggingId) ?? null;

  const onDragEnd = (event: DragEndEvent) => {
    setDraggingId(null);
    const over = event.over ? String(event.over.id) : null;
    if (!over?.startsWith('day:') || !onMove) return;
    const date = over.slice('day:'.length);
    const entry = entries.find((candidate) => candidate.id === String(event.active.id));
    // Dropping a card back where it started is not a change.
    if (entry && entry.date !== date) onMove(entry, date);
  };

  const entryProps = (entry: CalendarEntry) => ({
    href: entry.href,
    title: describe(entry),
    onClick: onSelect
      ? (event: React.MouseEvent) => {
          // A modified click is somebody asking for a new tab; let the link
          // do its job.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          onSelect(entry);
        }
      : undefined,
    style: colorOf?.(entry)
      ? { borderLeftWidth: '3px', borderLeftColor: colorOf(entry) }
      : undefined,
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {/* Square pills change which month you are looking at; the round gold
            chips below narrow what is on it. */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={buttonClass}
            onClick={() => onMonthChange(addMonths(monthStart, -1))}
          >
            ‹ Prev
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => onMonthChange(monthStartOf(today))}
          >
            This month
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => onMonthChange(addMonths(monthStart, 1))}
          >
            Next ›
          </button>
          <span className="font-mono text-xl font-bold text-white/80">
            {formatMonth(monthStart)}
          </span>
          {refreshing && <span className="font-mono text-xs text-white/40">Loading…</span>}
        </div>

        {(chips || !monthIsPast) && (
          <div className="flex flex-wrap items-center gap-2">
            <span className={toolbarCaptionClass}>Filter</span>
            {chips}
            {!monthIsPast && (
              <button
                type="button"
                className={`${filterChipClass(showPast)} sm:hidden`}
                aria-pressed={showPast}
                title="Show days earlier in the month"
                onClick={() => setShowPast((value) => !value)}
              >
                Earlier{hiddenPast > 0 ? ` (${hiddenPast})` : ''}
              </button>
            )}
          </div>
        )}
      </div>

      {/* The grid, from sm up. */}
      <div className="hidden overflow-x-auto sm:block">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-7">
            {WEEKDAY_HEADERS.map((label) => (
              <div
                key={label}
                className="border-b border-white/10 px-2 py-1.5 font-mono text-xs font-bold uppercase tracking-wide text-white/50"
              >
                {label}
              </div>
            ))}
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={dayCollisions}
            onDragStart={(event: DragStartEvent) => setDraggingId(String(event.active.id))}
            onDragEnd={onDragEnd}
            onDragCancel={() => setDraggingId(null)}
          >
            {weeks.map((week) => (
              <div key={week[0]} className="grid grid-cols-7">
                {week.map((date) => {
                  const inMonth = date.slice(0, 7) === monthStart.slice(0, 7);
                  const day = byDate.get(date) ?? [];
                  return (
                    <DroppableDay
                      key={date}
                      date={date}
                      disabled={!onMove}
                      className={`min-h-[110px] border-b border-l border-white/10 p-1.5 last:border-r ${
                        inMonth ? '' : 'bg-white/[0.02] opacity-40'
                      }`}
                    >
                      <div
                        className={`mb-1 text-right font-mono text-[11px] ${
                          date === today ? 'font-bold text-[var(--pyre-red)]' : 'text-white/40'
                        }`}
                      >
                        {Number(date.slice(8))}
                      </div>
                      <div className="space-y-1">
                        {day.map((entry) =>
                          canMove(entry) ? (
                            <DraggableEntry key={entry.id} id={entry.id}>
                              {({ listeners, attributes }) => (
                                <a
                                  className={`block cursor-grab touch-none overflow-hidden rounded border px-1.5 py-1 transition-colors hover:brightness-125 active:cursor-grabbing ${toneOf(entry, today)}`}
                                  {...entryProps(entry)}
                                  {...listeners}
                                  {...attributes}
                                >
                                  <EntryText entry={entry} />
                                </a>
                              )}
                            </DraggableEntry>
                          ) : (
                            <a
                              key={entry.id}
                              className={`block overflow-hidden rounded border px-1.5 py-1 transition-colors hover:brightness-125 ${toneOf(entry, today)}`}
                              {...entryProps(entry)}
                            >
                              <EntryText entry={entry} />
                            </a>
                          )
                        )}
                      </div>
                    </DroppableDay>
                  );
                })}
              </div>
            ))}

            {/* The ghost under the cursor. No drop animation: the entry
                reappears on its new day the moment the caller saves. */}
            <DragOverlay dropAnimation={null}>
              {draggingEntry && (
                <div
                  className={`rounded border px-1.5 py-1 shadow-xl ${toneOf(draggingEntry, today)}`}
                >
                  <EntryText entry={draggingEntry} />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>
      </div>

      {/* The agenda, below sm. */}
      <div className="space-y-4 sm:hidden">
        {agendaDays.length === 0 && (
          <p className="font-mono text-xs text-white/40">
            {byDate.size === 0 ? emptyNote : 'Nothing left this month.'}
          </p>
        )}
        {agendaDays.map((date) => (
          <div key={date}>
            <h3
              className={`mb-1.5 font-mono text-xs uppercase tracking-wide ${
                date === today ? 'font-bold text-[var(--pyre-red)]' : 'text-white/50'
              }`}
            >
              {WEEKDAY_LONG[weekdayIndex(date)]} {formatYmd(date)}
              {date === today && ' · today'}
            </h3>
            <div className="space-y-1.5">
              {(byDate.get(date) ?? []).map((entry) => (
                <a
                  key={entry.id}
                  className={`flex min-h-11 items-center gap-2 rounded border px-3 py-2 ${toneOf(entry, today)}`}
                  {...entryProps(entry)}
                >
                  <span className="w-14 shrink-0 font-mono text-[11px] text-white/60">
                    {formatEntryTime(entry) || 'all day'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-sm ${entry.finished ? 'line-through' : ''}`}
                    >
                      {entry.label}
                      {entry.overnight && <span className="text-white/50"> +1</span>}
                    </span>
                    <span className="block truncate font-mono text-[10px] text-white/60">
                      {entry.detail}
                      {entry.boardName ? ` · ${entry.boardName}` : ''}
                    </span>
                  </span>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-white/50">
        <Swatch className={ENTRY_TONE.field}>on the day</Swatch>
        <Swatch className={ENTRY_TONE.due}>due</Swatch>
        <Swatch className={OVERDUE_TONE}>overdue</Swatch>
        <Swatch className={ENTRY_TONE.goal}>goal target</Swatch>
        <Swatch className={FINISHED_TONE}>finished</Swatch>
        {legend}
      </div>
    </div>
  );
}

/** An entry's two lines: what it is, and why it is on this day. */
function EntryText({ entry }: { entry: CalendarEntry }) {
  const time = formatEntryTime(entry);
  return (
    <>
      <span
        className={`block truncate text-[11px] font-semibold leading-tight ${
          entry.finished ? 'line-through' : ''
        }`}
      >
        {time && <span className="font-mono">{time} </span>}
        {entry.label}
        {entry.overnight && <span className="text-white/50"> +1</span>}
      </span>
      <span className="block truncate font-mono text-[10px] leading-tight text-white/60">
        {entry.detail}
        {entry.boardName ? ` · ${entry.boardName}` : ''}
      </span>
    </>
  );
}

function Swatch({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span>
      <span
        className={`mr-1 inline-block h-2.5 w-2.5 rounded-sm border align-middle ${className}`}
      />
      {children}
    </span>
  );
}

/** 0 = Sunday, matching the grid. */
function weekdayIndex(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
