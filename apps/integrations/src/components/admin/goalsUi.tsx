// Shared presentation for the goals and boards tools — the index cards, the
// goal page, All Tasks, and the board views all render the same meters,
// chips, and badges, so a goal reads identically wherever it appears.
//
// Follows the incidentUi / guestUi pattern: class constants hoisted out of
// the components that use them, controls sized for a phone first, and one
// `send` helper so every mutation reports the API's own message.

import type { ReactNode } from 'react';
import type {
  BoardCardRow,
  BoardColumnKind,
  BoardColumnRow,
  GoalKpiRow,
  GoalStatus,
} from '@/lib/db';
import { formatKpiValue, kpiFreshness, kpiProgress } from '@/lib/goals/kpis';
import { PACE_LABELS, type PaceState, type TaskProgress } from '@/lib/goals/progress';
import { GOAL_STATUS_LABELS } from '@/lib/goals/types';
import { readError } from './incidentUi';

export const inputBaseClass =
  'px-3 py-2.5 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30';

export const inputClass = `w-full ${inputBaseClass}`;

export const selectClass = `${inputClass} [&>option]:bg-[var(--pyre-black)]`;

export const textareaClass = `${inputClass} min-h-[110px]`;

export const labelClass = 'block mb-1.5 font-mono text-xs uppercase tracking-wide text-white/50';

export const buttonClass =
  'px-3 py-2 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

export const primaryButtonClass =
  'px-3 py-2 rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 text-xs font-mono uppercase tracking-wide text-[var(--pyre-gold)] hover:border-[var(--pyre-gold)] transition-colors disabled:opacity-40';

export const dangerButtonClass =
  'px-3 py-2 rounded border border-[var(--pyre-red)]/50 bg-[var(--pyre-red)]/10 text-xs font-mono uppercase tracking-wide text-[var(--pyre-red)] hover:border-[var(--pyre-red)] transition-colors disabled:opacity-40';

export const cardClass = 'rounded border border-white/10 bg-white/[0.03] p-4';

// A card sitting above the others — the goal at the top of a board, which
// the columns beneath serve. A brighter surface, a firmer edge, and a
// shadow to lift it; the columns keep the flat card.
export const raisedCardClass =
  'rounded-lg border border-white/20 bg-white/[0.07] p-5 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.04)]';

// Every row a finger has to land on. 40px is the floor; the paddings above
// are picked to clear it with a line of text inside.
export const rowClass =
  'flex min-h-[44px] w-full items-start gap-3 rounded border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:border-white/25';

const badgeBase =
  'inline-block whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide';

const GOAL_STATUS_STYLES: Record<GoalStatus, string> = {
  planned: 'border-white/15 bg-white/5 text-white/50',
  active: 'border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 text-[var(--pyre-gold)]',
  completed: 'border-[var(--pyre-sage)]/50 bg-[var(--pyre-sage)]/10 text-[var(--pyre-sage)]',
  dropped: 'border-white/10 bg-white/5 text-white/30',
};

export function GoalStatusBadge({ status }: { status: GoalStatus }) {
  return (
    <span className={`${badgeBase} ${GOAL_STATUS_STYLES[status]}`}>
      {GOAL_STATUS_LABELS[status]}
    </span>
  );
}

// Pace is the one chip that should be readable at a glance from across a
// desk, so overdue is the only red on the page.
const PACE_STYLES: Record<PaceState, string> = {
  none: 'border-white/10 bg-white/5 text-white/35',
  ahead: 'border-[var(--pyre-sage)]/50 bg-[var(--pyre-sage)]/10 text-[var(--pyre-sage)]',
  on_track: 'border-white/20 bg-white/5 text-white/60',
  behind: 'border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 text-[var(--pyre-gold)]',
  overdue: 'border-[var(--pyre-red)]/60 bg-[var(--pyre-red)]/15 text-[var(--pyre-red)]',
  done: 'border-white/10 bg-white/5 text-white/35',
};

export function PaceChip({ pace }: { pace: PaceState }) {
  if (pace === 'none') return null;
  return <span className={`${badgeBase} ${PACE_STYLES[pace]}`}>{PACE_LABELS[pace]}</span>;
}

/** A neutral, quiet chip for areas, counts, and board names. */
export function QuietChip({ children }: { children: ReactNode }) {
  return (
    <span className={`${badgeBase} border-white/10 bg-white/5 text-white/50`}>{children}</span>
  );
}

/** "Waiting on Sarah's availability" — why an in-progress card is stuck. */
export function WaitingBadge({ waitingOn }: { waitingOn: string }) {
  return (
    <span
      className={`${badgeBase} max-w-full overflow-hidden text-ellipsis border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 text-[var(--pyre-gold)]`}
      title={`Waiting on ${waitingOn}`}
    >
      Waiting: {waitingOn}
    </span>
  );
}

const COLUMN_KIND_DOT: Record<BoardColumnKind, string> = {
  open: 'bg-white/30',
  done: 'bg-[var(--pyre-sage)]',
  dropped: 'bg-white/15',
};

// Backlog and active columns both have kind "open". Recognize their workflow
// names without changing completion semantics. A recognized label wins over
// the stable key, so renaming "To do" to "Active" changes the indicator too.
const OPEN_COLUMN_ACTIVE: Record<string, boolean> = {
  backlog: false,
  todo: false,
  to_do: false,
  new: false,
  active: true,
  in_progress: true,
  in_flight: true,
  doing: true,
};

export function ColumnDot({ column }: { column: Pick<BoardColumnRow, 'key' | 'label' | 'kind'> }) {
  const labelKey = column.label
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const active = OPEN_COLUMN_ACTIVE[labelKey] ?? OPEN_COLUMN_ACTIVE[column.key] ?? false;
  const color =
    column.kind === 'open' && active ? 'bg-[var(--pyre-gold)]' : COLUMN_KIND_DOT[column.kind];
  return (
    <span
      role="img"
      aria-label={column.label}
      title={column.label}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`}
    />
  );
}

/** The card's workflow status, kept beside its title for quick scanning. */
/**
 * A due date as the tools colour it: red once it is past, gold today and
 * tomorrow, quiet after that. Finished cards never shout — a task that
 * shipped late is not still late.
 */
export function DueChip({
  dueDate,
  today,
  finished = false,
}: {
  dueDate: string;
  today: string;
  finished?: boolean;
}) {
  const tone = finished
    ? 'border-white/10 bg-white/5 text-white/35'
    : dueDate < today
      ? 'border-[var(--pyre-red)]/60 bg-[var(--pyre-red)]/15 text-[var(--pyre-red)]'
      : dueDate === today
        ? 'border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 text-[var(--pyre-gold)]'
        : 'border-white/15 bg-white/5 text-white/50';
  return <span className={`${badgeBase} ${tone}`}>{formatYmd(dueDate)}</span>;
}

/** The task bar: "8 / 12" with the share that finished well. */
export function TaskBar({ progress }: { progress: TaskProgress }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuenow={progress.pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Tasks done"
      >
        <div
          className="h-full rounded-full bg-[var(--pyre-sage)] transition-[width]"
          style={{ width: `${progress.pct}%` }}
        />
      </div>
      <span className="shrink-0 font-mono text-[11px] text-white/45">
        {progress.done} / {progress.total}
      </span>
    </div>
  );
}

/**
 * One KPI as a meter: how far it has come on the start → target scale, met
 * or not, and how long ago anybody checked. The freshness line is the part
 * that keeps a hand-measured number honest.
 */
export function KpiMeter({
  kpi,
  nowIso,
  compact = false,
}: {
  kpi: GoalKpiRow;
  nowIso: string;
  compact?: boolean;
}) {
  const progress = kpiProgress(kpi);
  const days = kpiFreshness(kpi, nowIso);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-[var(--pyre-creme)]" title={kpi.name}>
          {kpi.name}
        </span>
        <span
          className={`shrink-0 font-mono text-[11px] ${
            progress.met ? 'text-[var(--pyre-sage)]' : 'text-white/45'
          }`}
        >
          {formatKpiValue(kpi.current_value, kpi.unit)} /{' '}
          {formatKpiValue(kpi.target_value, kpi.unit)}
          {progress.met && ' ✓'}
        </span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuenow={progress.pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={kpi.name}
      >
        <div
          className={`h-full rounded-full transition-[width] ${
            progress.met ? 'bg-[var(--pyre-sage)]' : 'bg-[var(--pyre-gold)]'
          }`}
          style={{ width: `${progress.pct}%` }}
        />
      </div>
      {!compact && (
        <p className="mt-1 font-mono text-[10px] text-white/35">
          {!progress.measured
            ? 'never measured'
            : days === 0
              ? 'measured today'
              : `measured ${days} day${days === 1 ? '' : 's'} ago`}
        </p>
      )}
    </div>
  );
}

/** Section heading with an optional aside, as every panel here uses. */
export function SectionTitle({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="font-mono text-xs uppercase tracking-wide text-white/50">{children}</h2>
      {note && <span className="font-mono text-[11px] text-white/35">{note}</span>}
    </div>
  );
}

/** "Tue, 21 Sep" for a YYYY-MM-DD, spelled rather than formatted (see allTasks). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatYmd(ymd: string): string {
  const [year, month, day] = ymd.split('-').map(Number);
  if (!year || !month || !day || month < 1 || month > 12) return ymd;
  return `${day} ${MONTHS[month - 1]}`;
}

/** JSON mutation against the goals/boards routes; throws with the API's message. */
export async function send<T>(
  url: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: unknown
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

/** Today in America/New_York, matching what the routes store on a card. */
export function todayEastern(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/** A card the drawer and the rows both need to key and link. */
export function cardAnchorId(card: Pick<BoardCardRow, 'id'>): string {
  return `card-${card.id}`;
}
