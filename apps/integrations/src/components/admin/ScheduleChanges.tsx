// Change log for /admin/schedule/changes (admin-only): who changed what on
// the staff schedule, newest first. Reads /api/admin/schedule-changes with
// keyset "load more" pagination; each row expands to the stored
// before/after details.

import { useCallback, useMemo, useState } from 'react';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import { buttonClass } from '@/components/admin/ui';
import { useCachedJson } from '@/lib/client/cachedJson';
import type { ScheduleChangeRow } from '@/lib/schedule/change-log';

const FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Everything' },
  { value: 'shift', label: 'Shifts' },
  { value: 'assignment', label: 'Assignments' },
  { value: 'time_off', label: 'Time off' },
  { value: 'proposal', label: 'Draft proposals' },
  { value: 'request', label: 'Shift requests' },
  { value: 'sub_request', label: 'Sub requests' },
  { value: 'agent_instructions', label: 'Drafter instructions' },
  { value: 'staff_prefs', label: 'Shift preferences' },
  { value: 'duty_assignment', label: 'Off-shift duties' },
  { value: 'duty_training', label: 'Duty training' },
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
  agent_instructions: 'Drafter instructions',
  staff_prefs: 'Shift preferences',
  duty_assignment: 'Off-shift duty',
  duty_training: 'Duty training',
  swap_offer: 'Swap offer',
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

interface ChangesPage {
  entries: ScheduleChangeRow[];
  hasMore: boolean;
}

/** The log route with its filter and keyset cursor. */
function changesUrl(filter: string, before?: string): string {
  const params = new URLSearchParams();
  if (filter) params.set('entityType', filter);
  if (before) params.set('before', before);
  return `/api/admin/schedule-changes?${params}`;
}

export function ScheduleChanges() {
  const [filter, setFilter] = useState('');
  // The first page of each filter is cached, so switching filters you have
  // already looked at (or coming back to the log) repaints at once.
  const firstUrl = useMemo(() => changesUrl(filter), [filter]);
  const first = useCachedJson<ChangesPage>(firstUrl);
  // "Load more" pages append behind the first page; they belong to the
  // filter they were fetched under and fall away when it changes.
  const [more, setMore] = useState<{ filter: string; page: ChangesPage } | null>(null);
  const [paging, setPaging] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const moreForFilter = more && more.filter === filter ? more.page : null;
  const entries = useMemo(
    () => [...(first.data?.entries ?? []), ...(moreForFilter?.entries ?? [])],
    [first.data, moreForFilter]
  );
  const hasMore = moreForFilter ? moreForFilter.hasMore : (first.data?.hasMore ?? false);
  const loading = first.loading || paging;
  const error = pageError ?? first.error;

  const loadMore = useCallback(
    async (before: string) => {
      setPaging(true);
      setPageError(null);
      try {
        const res = await fetch(changesUrl(filter, before));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as ChangesPage;
        setMore((prev) => ({
          filter,
          page: {
            entries: [
              ...(prev && prev.filter === filter ? prev.page.entries : []),
              ...body.entries,
            ],
            hasMore: body.hasMore,
          },
        }));
      } catch (e) {
        setPageError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setPaging(false);
      }
    },
    [filter]
  );

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

      {error && <ErrorBanner mono>{error}</ErrorBanner>}

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
                {/* Full width of its own line on a phone: sharing the line with
                    the 10rem timestamp leaves ~50px here, which `min-w-0` then
                    lets shrink below a single word — the summary spilled past
                    the right edge of the screen. break-words covers the emails
                    and ids that turn up in a summary. */}
                <span className="w-full min-w-0 break-words text-sm text-white/80 sm:w-auto sm:flex-1">
                  {entry.summary}
                </span>
              </div>
              {Object.keys(entry.details ?? {}).length > 0 && (
                <details
                  // The indent lines Details up under the summary column,
                  // which only shares the timestamp's line from sm up.
                  className="mt-1 sm:pl-[10.75rem]"
                >
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
          onClick={() => {
            const last = entries[entries.length - 1]?.created_at;
            if (last) void loadMore(last);
          }}
        >
          Load more
        </button>
      )}
    </div>
  );
}
