// Checklist-run log (/admin/sops/runs). The shared record of who has completed
// what: everyone gets the same filter bar — status, SOP, person (anyone who
// started, ended, or checked something), date, and checked-item text, which
// surfaces matching checks inline so "who completed task X" reads at a glance.
// A "Started by me" toggle narrows to the runs the viewer opened themselves —
// the ones they are answerable for — and those runs are tagged in the list
// either way. A non-admin's log is narrowed to runs of the SOPs they may view; that
// scoping is enforced by the API, and this island just renders what it's
// given. isAdmin decides one thing here: whether a run can be deleted.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type PeopleNames, personName, sameActor } from '@/lib/sops/names';
import { type RunEntry, RunsList } from './SopRunsList';

const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

const inputClass =
  'px-3 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30';

const selectClass =
  'px-2 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] focus:outline-none focus:border-white/30 [&>option]:bg-[var(--pyre-black)]';

// 'Abandoned' only turns up runs from before ending early became a discard
// (which deletes the run); kept so that history stays reachable.
const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'abandoned', label: 'Abandoned' },
] as const;

async function readError(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** Everyone who touched this run: started, ended, or checked an item. */
function participants(run: RunEntry): string[] {
  const set = new Set<string>([run.started_by]);
  if (run.ended_by) set.add(run.ended_by);
  for (const check of run.sop_run_checks) set.add(check.checked_by);
  return [...set];
}

/** The run's reference time for date filtering: when it ended, else started. */
function runTime(run: RunEntry): number {
  return Date.parse(run.ended_at ?? run.started_at);
}

export function SopRunsBoard({ isAdmin }: { isAdmin: boolean }) {
  const [runs, setRuns] = useState<RunEntry[]>([]);
  // Roster names for the emails the runs record, from the same response.
  const [names, setNames] = useState<PeopleNames>({});
  // The session email, from the same response; marks and filters own runs.
  const [viewerEmail, setViewerEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]['key']>('all');
  const [onlyMine, setOnlyMine] = useState(false);
  const [sopFilter, setSopFilter] = useState('all');
  const [personFilter, setPersonFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [itemQuery, setItemQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/sop-runs?view=list');
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as {
        runs: RunEntry[];
        people?: PeopleNames;
        viewer?: string;
      };
      setRuns(body.runs);
      setNames(body.people ?? {});
      setViewerEmail(body.viewer ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load runs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const deleteRun = async (run: RunEntry) => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/sop-runs?id=${run.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readError(res));
      setRuns((prev) => prev.filter((r) => r.id !== run.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete the run');
    }
  };

  const sops = useMemo(() => {
    const bySlug = new Map<string, string>();
    for (const run of runs) if (run.sops) bySlug.set(run.sop_id, run.sops.title);
    return [...bySlug.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [runs]);

  // Filter options: participant emails (the filter value), ordered by the
  // name they show under.
  const personOptions = useMemo(() => {
    const set = new Set<string>();
    for (const run of runs) for (const p of participants(run)) set.add(p);
    return [...set].sort((a, b) => personName(a, names).localeCompare(personName(b, names)));
  }, [runs, names]);

  const mineCount = useMemo(
    () => runs.filter((run) => sameActor(run.started_by, viewerEmail)).length,
    [runs, viewerEmail]
  );

  const visible = useMemo(() => {
    const query = itemQuery.trim().toLowerCase();
    const from = fromDate ? Date.parse(fromDate) : null;
    // Inclusive end date: anything before the *next* midnight.
    const to = toDate ? Date.parse(toDate) + 24 * 60 * 60 * 1000 : null;
    return runs.filter((run) => {
      if (status !== 'all' && run.status !== status) return false;
      if (onlyMine && !sameActor(run.started_by, viewerEmail)) return false;
      if (sopFilter !== 'all' && run.sop_id !== sopFilter) return false;
      if (personFilter !== 'all' && !participants(run).includes(personFilter)) return false;
      if (from !== null && runTime(run) < from) return false;
      if (to !== null && runTime(run) >= to) return false;
      if (query && !run.sop_run_checks.some((c) => c.item_text.toLowerCase().includes(query))) {
        return false;
      }
      return true;
    });
  }, [runs, status, onlyMine, viewerEmail, sopFilter, personFilter, fromDate, toDate, itemQuery]);

  if (loading) return <p className="font-mono text-xs text-white/40">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <a href="/admin/sops" className={buttonClass}>
          ← All SOPs
        </a>
        <span className="mx-2 h-4 w-px bg-white/10" />
        {STATUS_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`${buttonClass} ${status === key ? 'border-white/40 text-white' : ''}`}
            onClick={() => setStatus(key)}
          >
            {label}
            {key !== 'all' && ` (${runs.filter((r) => r.status === key).length})`}
          </button>
        ))}
        <span className="mx-2 h-4 w-px bg-white/10" />
        <button
          type="button"
          className={`${buttonClass} ${onlyMine ? 'border-[var(--pyre-gold)]/60 text-[var(--pyre-gold)]' : ''}`}
          onClick={() => setOnlyMine((v) => !v)}
          aria-pressed={onlyMine}
          disabled={!viewerEmail}
        >
          Started by me ({mineCount})
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded border border-white/10 bg-white/5 p-3">
        <label className="flex items-center gap-2 font-mono text-xs text-white/60">
          SOP
          <select
            className={selectClass}
            value={sopFilter}
            onChange={(e) => setSopFilter(e.target.value)}
          >
            <option value="all">All</option>
            {sops.map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 font-mono text-xs text-white/60">
          person
          <select
            className={selectClass}
            value={personFilter}
            onChange={(e) => setPersonFilter(e.target.value)}
          >
            <option value="all">Anyone</option>
            {personOptions.map((p) => (
              <option key={p} value={p}>
                {personName(p, names)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 font-mono text-xs text-white/60">
          from
          <input
            type="date"
            className={inputClass}
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 font-mono text-xs text-white/60">
          to
          <input
            type="date"
            className={inputClass}
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </label>
        <input
          type="search"
          className={`${inputClass} min-w-48 flex-1`}
          placeholder="Filter by checked item (e.g. “light fire”)…"
          value={itemQuery}
          onChange={(e) => setItemQuery(e.target.value)}
          aria-label="Filter runs by checked item text"
        />
        {(status !== 'all' ||
          onlyMine ||
          sopFilter !== 'all' ||
          personFilter !== 'all' ||
          fromDate ||
          toDate ||
          itemQuery) && (
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              setStatus('all');
              setOnlyMine(false);
              setSopFilter('all');
              setPersonFilter('all');
              setFromDate('');
              setToDate('');
              setItemQuery('');
            }}
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 text-sm text-[var(--pyre-red)]">
          {error}
        </p>
      )}

      {!isAdmin && (
        <p className="font-mono text-[10px] text-white/40">
          Showing every run of the SOPs you can view.
        </p>
      )}

      {visible.length !== runs.length && (
        <p className="font-mono text-[10px] text-white/40">
          {visible.length} of {runs.length} runs match.
        </p>
      )}

      <RunsList
        runs={visible}
        people={names}
        viewerEmail={viewerEmail}
        itemQuery={itemQuery}
        onDelete={isAdmin ? (run) => void deleteRun(run) : undefined}
      />
    </div>
  );
}
