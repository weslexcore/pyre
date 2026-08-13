// Change log for /admin/schedule/changes (admin-only): who changed what on
// the staff schedule, newest first. Reads /api/admin/schedule-changes with
// keyset "load more" pagination; each row expands to the stored
// before/after details.

import { useCallback, useEffect, useState } from 'react';
import type { ScheduleChangeRow } from '@/lib/schedule/change-log';

const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

const FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Everything' },
  { value: 'shift', label: 'Shifts' },
  { value: 'assignment', label: 'Assignments' },
  { value: 'time_off', label: 'Time off' },
  { value: 'proposal', label: 'Draft proposals' },
  { value: 'request', label: 'Shift requests' },
  { value: 'sub_request', label: 'Sub requests' },
  { value: 'sync', label: 'Momence sync' },
];

const ENTITY_LABEL: Record<ScheduleChangeRow['entity_type'], string> = {
  shift: 'Shift',
  assignment: 'Assignment',
  time_off: 'Time off',
  proposal: 'Proposal',
  sync: 'Sync',
  request: 'Shift request',
  sub_request: 'Sub request',
};

const ACTOR_TINT: Record<ScheduleChangeRow['actor_kind'], string> = {
  user: 'text-[var(--pyre-creme)]',
  agent: 'text-[var(--pyre-gold)]',
  system: 'text-white/50',
};

const timestamp = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export function ScheduleChanges() {
  const [entries, setEntries] = useState<ScheduleChangeRow[]>([]);
  const [filter, setFilter] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (before?: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (filter) params.set('entityType', filter);
        if (before) params.set('before', before);
        const res = await fetch(`/api/admin/schedule-changes?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { entries: ScheduleChangeRow[]; hasMore: boolean };
        setEntries((prev) => (before ? [...prev, ...body.entries] : body.entries));
        setHasMore(body.hasMore);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    },
    [filter]
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded border text-xs font-mono uppercase tracking-wide transition-colors ${
              filter === f.value
                ? 'border-[var(--pyre-red)] bg-[var(--pyre-red)]/15 text-[var(--pyre-creme)]'
                : 'border-white/10 bg-white/5 text-white/50 hover:border-white/30 hover:text-white'
            }`}
          >
            {f.label}
          </button>
        ))}
        {loading && <span className="font-mono text-xs text-white/40">Loading…</span>}
      </div>

      {error && (
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-red)]">
          {error}
        </p>
      )}

      {entries.length === 0 && !loading ? (
        <p className="font-mono text-sm text-white/40">No changes logged yet.</p>
      ) : (
        <ul className="divide-y divide-white/5 rounded border border-white/10">
          {entries.map((entry) => (
            <li key={entry.id} className="px-3 py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="w-40 shrink-0 font-mono text-xs text-white/40">
                  {timestamp(entry.created_at)}
                </span>
                <span
                  className={`shrink-0 font-mono text-xs ${ACTOR_TINT[entry.actor_kind]}`}
                  title={entry.actor_email ?? undefined}
                >
                  {entry.actor_label}
                </span>
                <span className="shrink-0 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-white/40">
                  {ENTITY_LABEL[entry.entity_type]}
                </span>
                <span className="min-w-0 flex-1 text-sm text-white/80">{entry.summary}</span>
              </div>
              {Object.keys(entry.details ?? {}).length > 0 && (
                <details className="mt-1 pl-[10.75rem]">
                  <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-wide text-white/30 hover:text-white/60">
                    Details
                  </summary>
                  <pre className="mt-1 overflow-x-auto rounded bg-white/5 p-2 font-mono text-[11px] leading-relaxed text-white/60">
                    {JSON.stringify(entry.details, null, 2)}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <button
          type="button"
          className={buttonClass}
          disabled={loading}
          onClick={() => void load(entries[entries.length - 1]?.created_at)}
        >
          Load more
        </button>
      )}
    </div>
  );
}
