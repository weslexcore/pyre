// Every agent suggestion in one list (/admin/suggestions): pending ones as
// editors to decide, newest first, each under the record it came from with a
// link back to it; and, one filter away, what was decided and by whom.

import { useCallback, useEffect, useState } from 'react';
import type { PeopleNames } from '@/lib/sops/names';
import {
  KIND_LABELS,
  type SourceSummary,
  SUGGESTION_KINDS,
  type SuggestionKind,
  type SuggestionResultLink,
  type SuggestionView,
} from '@/lib/suggestions/types';
import { readError, selectClass } from '../ShiftNoteComposer';
import { SuggestionCard } from './SuggestionCard';

type StatusFilter = 'pending' | 'decided';

interface InboxResponse {
  suggestions: SuggestionView[];
  sources: Record<string, SourceSummary | null>;
  results: Record<string, SuggestionResultLink>;
  targets: Record<string, SuggestionResultLink>;
  people: PeopleNames;
  agentsConfigured: boolean;
}

export function SuggestionsInbox() {
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [kind, setKind] = useState<'all' | SuggestionKind>('all');
  const [data, setData] = useState<InboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status });
      if (kind !== 'all') params.set('kind', kind);
      const res = await fetch(`/api/admin/suggestions?${params}`);
      if (!res.ok) throw new Error(await readError(res));
      setData((await res.json()) as InboxResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load suggestions');
    } finally {
      setLoading(false);
    }
  }, [status, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const replace = (next: SuggestionView, result?: SuggestionResultLink) =>
    setData((prev) =>
      prev
        ? {
            ...prev,
            suggestions: prev.suggestions.map((s) =>
              s.id === next.id ? { ...next, sourceChanged: s.sourceChanged } : s
            ),
            results: result ? { ...prev.results, [next.id]: result } : prev.results,
          }
        : prev
    );

  const rows = data?.suggestions ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 font-mono text-xs text-white/60">
          show
          <select
            className={selectClass}
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          >
            <option value="pending">Waiting for a decision</option>
            <option value="decided">Decided</option>
          </select>
        </label>
        <label className="flex items-center gap-2 font-mono text-xs text-white/60">
          kind
          <select
            className={selectClass}
            value={kind}
            onChange={(e) => setKind(e.target.value as 'all' | SuggestionKind)}
          >
            <option value="all">Any kind</option>
            {SUGGESTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {data && !data.agentsConfigured && (
        <p className="rounded border border-white/15 px-3 py-2 font-mono text-xs text-white/50">
          The agents app isn’t configured here (AGENTS_BASE_URL / EVE_CHANNEL_SECRET), so no new
          suggestions will arrive.
        </p>
      )}
      {error && (
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 text-sm text-[var(--pyre-red)]">
          {error}
        </p>
      )}
      {loading && !data && <p className="font-mono text-xs text-white/40">Loading…</p>}
      {data && rows.length === 0 && (
        <p className="font-mono text-xs text-white/40">
          {status === 'pending'
            ? 'Nothing waiting. Press the AI button on any shift note to have the agent read it and suggest what to do.'
            : 'Nothing decided yet.'}
        </p>
      )}

      {rows.map((suggestion) => {
        const source = data?.sources[`${suggestion.source_type}:${suggestion.source_id}`];
        return (
          <article
            key={suggestion.id}
            className="space-y-2 rounded border border-white/10 bg-white/5 p-3"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {source ? (
                <a
                  href={source.href}
                  className="text-sm font-semibold text-[var(--pyre-creme)] underline decoration-white/20 hover:text-white"
                >
                  {source.label}
                </a>
              ) : (
                <span className="text-sm font-semibold text-white/40">Source deleted</span>
              )}
              <span className="font-mono text-[10px] text-white/40">
                suggested{' '}
                {new Date(suggestion.created_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  timeZone: 'America/New_York',
                })}
              </span>
            </div>
            {source?.excerpt && (
              <p className="line-clamp-3 whitespace-pre-wrap border-l-2 border-white/10 pl-2 text-xs text-white/50">
                {source.excerpt}
              </p>
            )}
            <SuggestionCard
              suggestion={suggestion}
              result={data?.results[suggestion.id]}
              target={data?.targets[suggestion.id]}
              names={data?.people ?? {}}
              onChange={replace}
            />
          </article>
        );
      })}
    </div>
  );
}
