// A page's view of the agent suggestions on its records (shift notes today):
// each record's suggestions and latest run, kept current while a run is under
// way, and the actions an admin takes on them. Pass `enabled: false` for
// viewers who aren't admins — nothing is fetched.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  RunView,
  SuggestionResultLink,
  SuggestionSourceType,
  SuggestionView,
} from '@/lib/suggestions/types';
import * as api from './client';

const POLL_MS = 4_000;
/** The route answers at most this many ids per request. */
const CHUNK = 100;

interface Loaded {
  suggestions: Record<string, SuggestionView[]>;
  runs: Record<string, RunView>;
  results: Record<string, SuggestionResultLink>;
  targets: Record<string, SuggestionResultLink>;
}

const EMPTY: Loaded = { suggestions: {}, runs: {}, results: {}, targets: {} };

function isActive(run: RunView | undefined): boolean {
  return run?.status === 'queued' || run?.status === 'running';
}

export function useSuggestions(
  sourceType: SuggestionSourceType,
  enabled: boolean,
  /** Hears about each decision, e.g. to re-read the record's history. */
  onDecided?: (sourceId: string) => void
) {
  const [state, setState] = useState<Loaded>(EMPTY);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollTick, setPollTick] = useState(0);
  const onDecidedRef = useRef(onDecided);
  onDecidedRef.current = onDecided;

  /**
   * Read (or re-read) these records' suggestions and runs. The caller decides
   * whether the viewer may (a page's own load knows before `enabled` does).
   */
  const refresh = useCallback(
    async (ids: readonly string[]) => {
      if (ids.length === 0) return;
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
      const answers = await Promise.all(
        chunks.map(async (chunk) => {
          const res = await fetch(
            `/api/admin/suggestions?source=${sourceType}&ids=${encodeURIComponent(chunk.join(','))}`
          );
          if (!res.ok) return null;
          return { chunk, data: (await res.json()) as Loaded };
        })
      );
      setState((prev) => {
        const next: Loaded = {
          suggestions: { ...prev.suggestions },
          runs: { ...prev.runs },
          results: { ...prev.results },
          targets: { ...prev.targets },
        };
        for (const answer of answers) {
          if (!answer) continue;
          for (const id of answer.chunk) {
            const rows = answer.data.suggestions[id];
            if (rows) next.suggestions[id] = rows;
            else delete next.suggestions[id];
            const run = answer.data.runs[id];
            if (run) next.runs[id] = run;
          }
          Object.assign(next.results, answer.data.results);
          Object.assign(next.targets, answer.data.targets);
        }
        return next;
      });
    },
    [sourceType]
  );

  const activeIds = useMemo(
    () =>
      Object.entries(state.runs)
        .filter(([, run]) => isActive(run))
        .map(([id]) => id)
        .sort()
        .join(','),
    [state.runs]
  );

  // Poll the records whose run is still going, until each settles (the
  // server reads a run open too long as failed, which settles it too).
  // biome-ignore lint/correctness/useExhaustiveDependencies: pollTick is the re-arm
  useEffect(() => {
    if (!enabled || !activeIds) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        await refresh(activeIds.split(','));
      } catch {
        // Retried on the next tick.
      }
      if (!cancelled) setPollTick((tick) => tick + 1);
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, activeIds, pollTick, refresh]);

  /** Ask the agent to look at a record now. */
  const suggest = useCallback(
    async (sourceId: string) => {
      setRequesting(sourceId);
      setError(null);
      try {
        const { run } = await api.requestSuggestions(sourceType, sourceId);
        setState((prev) => ({ ...prev, runs: { ...prev.runs, [sourceId]: run } }));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not ask the agent');
      } finally {
        setRequesting(null);
      }
    },
    [sourceType]
  );

  /** Swap one suggestion in place (after an edit or a decision). */
  const replace = useCallback((view: SuggestionView, result?: SuggestionResultLink) => {
    setState((prev) => ({
      ...prev,
      suggestions: {
        ...prev.suggestions,
        [view.source_id]: (prev.suggestions[view.source_id] ?? []).map((s) =>
          s.id === view.id ? { ...view, sourceChanged: s.sourceChanged } : s
        ),
      },
      results: result ? { ...prev.results, [view.id]: result } : prev.results,
    }));
  }, []);

  const decided = useCallback((sourceId: string) => {
    onDecidedRef.current?.(sourceId);
  }, []);

  /** Drop a deleted record. */
  const remove = useCallback((sourceId: string) => {
    setState((prev) => {
      const { [sourceId]: _s, ...suggestions } = prev.suggestions;
      const { [sourceId]: _r, ...runs } = prev.runs;
      return { ...prev, suggestions, runs };
    });
  }, []);

  /** Pending suggestions on one record — its chip. */
  const pendingCount = useCallback(
    (sourceId: string) =>
      (state.suggestions[sourceId] ?? []).filter(
        (s) => s.status === 'pending' || s.status === 'applying'
      ).length,
    [state.suggestions]
  );

  return {
    ...state,
    refresh,
    suggest,
    replace,
    decided,
    remove,
    pendingCount,
    requesting,
    error,
  };
}
