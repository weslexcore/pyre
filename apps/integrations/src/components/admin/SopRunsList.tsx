// Shared checklist-run list: the admin runs board and the per-SOP Runs panel
// both render runs through this — status, progress, who started/ended and
// when, expandable into the per-item record of who checked what at what time.
// `itemQuery` (from the board's item filter) auto-surfaces matching checks
// under each run without expanding, so "who completed task X" reads at a
// glance.
import { useState } from 'react';
import type { SopRunRow } from '@/lib/db';
import { type PeopleNames, personName } from '@/lib/sops/names';

export interface RunCheck {
  item_index: number;
  item_text: string;
  checked_by: string;
  checked_at: string;
}

export interface RunEntry extends SopRunRow {
  sops: { title: string; slug: string; category: string } | null;
  sop_run_checks: RunCheck[];
}

// 'abandoned' is historical: ending a run early now discards it outright, so
// only runs from before that change carry the status.
export const STATUS_META: Record<SopRunRow['status'], { label: string; className: string }> = {
  in_progress: { label: 'In progress', className: 'text-[var(--pyre-gold)]' },
  completed: { label: 'Completed', className: 'text-[var(--pyre-sage)]' },
  abandoned: { label: 'Abandoned', className: 'text-white/40' },
};

// Pinned locale + venue time zone so server and client renders agree (the
// SOP page hydrates from server-rendered markup).
export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(startIso: string, endIso: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function CheckLine({ check, people }: { check: RunCheck; people?: PeopleNames }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 text-xs">
      <span className="text-[var(--pyre-sage)]">✓</span>
      <span className="text-white/70">{check.item_text}</span>
      <span className="ml-auto font-mono text-[10px] text-white/40">
        {personName(check.checked_by, people)} · {formatWhen(check.checked_at)}
      </span>
    </li>
  );
}

export function RunsList({
  runs,
  people,
  itemQuery = '',
  showSopTitle = true,
  onDelete,
}: {
  runs: RunEntry[];
  /** Roster names, so runs and checks read as people rather than emails. */
  people?: PeopleNames;
  /** When set, checks matching this text show inline under each run. */
  itemQuery?: string;
  /** Off for the per-SOP panel, where every run is the same document. */
  showSopTitle?: boolean;
  /** Admin-only: renders a delete button in the expanded view when set. */
  onDelete?: (run: RunEntry) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const query = itemQuery.trim().toLowerCase();

  if (runs.length === 0) {
    return (
      <p className="text-sm text-white/60">
        No runs here yet. Runs appear when someone starts a checklist from an SOP page.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {runs.map((run) => {
        const status = STATUS_META[run.status];
        const checks = [...run.sop_run_checks].sort(
          (a, b) => Date.parse(a.checked_at) - Date.parse(b.checked_at)
        );
        const matched = query
          ? checks.filter((c) => c.item_text.toLowerCase().includes(query))
          : [];
        const isOpen = expanded === run.id;
        const complete = checks.length >= run.task_count;
        return (
          <li key={run.id} className="rounded border border-white/10 bg-white/5">
            <button
              type="button"
              className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-4 text-left"
              onClick={() => setExpanded(isOpen ? null : run.id)}
              aria-expanded={isOpen}
            >
              <span className={`font-mono text-[10px] uppercase tracking-wide ${status.className}`}>
                {status.label}
              </span>
              {showSopTitle && (
                <span className="font-semibold text-[var(--pyre-creme)]">
                  {run.sops?.title ?? 'Deleted SOP'}
                </span>
              )}
              <span
                className={`font-mono text-xs ${complete ? 'text-[var(--pyre-sage)]' : 'text-white/60'}`}
              >
                {checks.length}/{run.task_count}
                {run.status === 'completed' && !complete && ' — items skipped'}
              </span>
              <span className="ml-auto text-right font-mono text-[10px] text-white/40">
                started by {personName(run.started_by, people)} · {formatWhen(run.started_at)}
                {run.ended_at && run.ended_by && (
                  <>
                    <br />
                    ended by {personName(run.ended_by, people)} · {formatWhen(run.ended_at)} (
                    {formatDuration(run.started_at, run.ended_at)})
                  </>
                )}
              </span>
            </button>
            {!isOpen && matched.length > 0 && (
              <ul className="space-y-1 border-t border-white/10 px-4 py-2">
                {matched.map((check) => (
                  <CheckLine key={check.item_index} check={check} people={people} />
                ))}
              </ul>
            )}
            {isOpen && (
              <div className="border-t border-white/10 p-4">
                {showSopTitle && run.sops && (
                  <a
                    href={`/admin/sops/${run.sops.slug}`}
                    className="font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)] underline hover:text-white"
                  >
                    Open SOP (v{run.sop_version} at run time)
                  </a>
                )}
                {checks.length === 0 ? (
                  <p className="mt-2 text-xs text-white/40">No items were checked.</p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {checks.map((check) => (
                      <CheckLine key={check.item_index} check={check} people={people} />
                    ))}
                  </ul>
                )}
                {run.status !== 'in_progress' && checks.length < run.task_count && (
                  <p className="mt-2 font-mono text-[10px] text-white/40">
                    {run.task_count - checks.length} item
                    {run.task_count - checks.length === 1 ? '' : 's'} never checked.
                  </p>
                )}
                {onDelete && (
                  <div className="mt-3 border-t border-white/10 pt-3">
                    <button
                      type="button"
                      className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-[var(--pyre-red)] transition-colors hover:border-[var(--pyre-red)]"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete this run of "${run.sops?.title ?? 'this SOP'}" and its ${checks.length} check record${checks.length === 1 ? '' : 's'}? This cannot be undone.`
                          )
                        ) {
                          onDelete(run);
                        }
                      }}
                    >
                      Delete run
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
