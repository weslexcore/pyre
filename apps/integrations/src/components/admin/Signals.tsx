// What the classifier found in a record, drawn as chips — and the hook that keeps those
// results current on a page. Generic over subjects: a page that lists
// classifiable records (shift notes today) seeds useClassifications with what
// its own GET returned, merges in what its writes return, and renders
// <SignalChips> per record. Classification runs in the background after a
// write, so records still being read are polled until they settle, and
// rerun() queues a fresh read of any record, classified before or not (the
// page puts that button with the record's other actions).
// Nothing here names the model behind the classifier (lib/classify picks it),
// so the page reads the same whichever one is answering.
//
// Labels come from @pyre/signals-core, so a new signal type shows up here
// with no change; SIGNAL_TONES only picks its colour (unknown → neutral).

import {
  SIGNAL_TYPES,
  type Signal,
  type SignalType,
  type SubjectType,
  signalLabel,
} from '@pyre/signals-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClassificationView } from '@/lib/classify/view';

const NEUTRAL_TONE = 'border-white/20 bg-white/5 text-white/70';

/** Chip colours per signal type: gold for work owed, red for risk. */
const SIGNAL_TONES: Partial<Record<SignalType, string>> = {
  action: 'border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 text-[var(--pyre-gold)]',
  question: 'border-[var(--pyre-blue)]/50 bg-[var(--pyre-blue)]/10 text-[var(--pyre-blue)]',
  update: 'border-[var(--pyre-creme)]/40 bg-[var(--pyre-creme)]/10 text-[var(--pyre-creme)]',
  feedback: 'border-[var(--pyre-sage)]/50 bg-[var(--pyre-sage)]/10 text-[var(--pyre-sage)]',
  safety: 'border-[var(--pyre-red)]/50 bg-[var(--pyre-red)]/10 text-[var(--pyre-red)]',
};

function toneOf(type: SignalType): string {
  return SIGNAL_TONES[type] ?? NEUTRAL_TONE;
}

/** The label chip on its own, for filters and legends. */
export function SignalTypeBadge({ type }: { type: SignalType }) {
  return (
    <span
      className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${toneOf(type)}`}
    >
      {signalLabel(type)}
    </span>
  );
}

function SignalChip({ signal }: { signal: Signal }) {
  const percent = Math.round(signal.probability * 100);
  return (
    <li title={`${signalLabel(signal.type)} — ${percent}% likely`}>
      <SignalTypeBadge type={signal.type} />
      <span className="sr-only"> ({percent}% likely)</span>
    </li>
  );
}

/** A set of signals as chips, e.g. what one run found. */
export function SignalList({ signals }: { signals: readonly Signal[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Detected">
      {signals.map((signal) => (
        <SignalChip key={signal.type} signal={signal} />
      ))}
    </ul>
  );
}

/**
 * One record's classification: its signals, or where the read stands. Draws
 * nothing for a record never classified.
 */
export function SignalChips({
  classification,
}: {
  classification: ClassificationView | undefined;
}) {
  if (!classification) return null;
  if (classification.state === 'pending') {
    return (
      <p
        className="mt-2 flex items-center gap-2 font-mono text-[10px] text-white/40"
        aria-live="polite"
      >
        ✦ Reading…
      </p>
    );
  }
  if (classification.state === 'failed') {
    return (
      <p className="mt-2 flex items-center gap-2 font-mono text-[10px] text-white/40">
        ✦ Couldn’t classify this.
      </p>
    );
  }
  if (classification.signals.length === 0) {
    return (
      <p className="mt-2 flex items-center gap-2 font-mono text-[10px] text-white/40">
        ✦ Nothing to act on.
      </p>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="font-mono text-[10px] text-white/40">✦</span>
      <SignalList signals={classification.signals} />
    </div>
  );
}

/** A <select> over the signal types, for filtering a list by what was found. */
export function SignalFilter({
  value,
  onChange,
  className,
}: {
  value: 'all' | SignalType;
  onChange: (value: 'all' | SignalType) => void;
  className?: string;
}) {
  return (
    <label className="flex items-center gap-2 font-mono text-xs text-white/60">
      detected
      <select
        className={className}
        value={value}
        onChange={(e) => onChange(e.target.value as 'all' | SignalType)}
      >
        <option value="all">Anything</option>
        {SIGNAL_TYPES.map((type) => (
          <option key={type} value={type}>
            {signalLabel(type)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Whether a classification carries a signal of `type`. */
export function hasSignal(view: ClassificationView | undefined, type: SignalType): boolean {
  return !!view && view.signals.some((s) => s.type === type);
}

const POLL_MS = 3_000;

/** How long a just-written record may show "Reading…" before its row exists. */
const UNFILED_GRACE_MS = 60_000;

/**
 * A page's classifications for one subject, keyed by record id, kept current:
 * pending ones are polled (GET /api/admin/classifications) until they settle
 * or time out, and rerun() asks for a fresh read of one record. Pass
 * `enabled: false` for viewers who don't see signals — nothing is fetched.
 * `onSettled` hears about each read the poll sees finish (done or failed),
 * e.g. to refresh the record's activity, where the answer is recorded.
 */
export function useClassifications(
  subject: SubjectType,
  enabled: boolean,
  onSettled?: (id: string, view: ClassificationView) => void
) {
  const [classifications, setClassifications] = useState<Record<string, ClassificationView>>({});
  // Latest callback without re-arming the poll every render.
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const [rerunning, setRerunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after every poll so the next one arms even when nothing changed.
  const [pollTick, setPollTick] = useState(0);

  /** Replace everything (the page's own load). */
  const reset = useCallback((next: Record<string, ClassificationView> | undefined) => {
    setClassifications(next ?? {});
  }, []);

  /** Fold in one record's view (a write's response); undefined leaves it alone. */
  const merge = useCallback((id: string, view: ClassificationView | undefined) => {
    if (view) setClassifications((prev) => ({ ...prev, [id]: view }));
  }, []);

  /** Drop a deleted record. */
  const remove = useCallback((id: string) => {
    setClassifications((prev) => {
      const { [id]: _gone, ...rest } = prev;
      return rest;
    });
  }, []);

  const pendingIds = useMemo(
    () =>
      Object.entries(classifications)
        .filter(([, view]) => view.state === 'pending')
        .map(([id]) => id)
        .sort()
        .join(','),
    [classifications]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: pollTick is the re-arm, not a value this reads
  useEffect(() => {
    if (!enabled || !pendingIds) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/classifications?subject=${subject}&ids=${encodeURIComponent(pendingIds)}`
        );
        if (res.ok && !cancelled) {
          const data = (await res.json()) as {
            classifications: Record<string, ClassificationView>;
          };
          if (!cancelled) {
            for (const id of pendingIds.split(',')) {
              const fresh = data.classifications[id];
              if (fresh && fresh.state !== 'pending') onSettledRef.current?.(id, fresh);
            }
            setClassifications((prev) => {
              const next = { ...prev };
              const now = Date.now();
              for (const id of pendingIds.split(',')) {
                // Settled, still pending, or — once the server's timeout
                // passes — failed.
                const fresh = data.classifications[id];
                if (fresh) {
                  next[id] = fresh;
                  continue;
                }
                // No row yet: the background run that files it may not have
                // started. Keep waiting a little; after that the record was
                // deleted elsewhere or classification is off, so stop polling.
                const current = prev[id];
                if (!current || now - new Date(current.requestedAt).getTime() > UNFILED_GRACE_MS) {
                  delete next[id];
                }
              }
              return next;
            });
          }
        }
      } catch {
        // A missed poll is simply retried on the next tick.
      }
      if (!cancelled) setPollTick((tick) => tick + 1);
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, pendingIds, pollTick, subject]);

  const rerun = useCallback(
    async (id: string) => {
      setRerunning(id);
      setError(null);
      try {
        const res = await fetch('/api/admin/classifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject, id }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          classification?: ClassificationView;
          error?: string;
        };
        if (!res.ok || !data.classification) throw new Error(data.error ?? `HTTP ${res.status}`);
        merge(id, data.classification);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not run the classifier');
      } finally {
        setRerunning(null);
      }
    },
    [merge, subject]
  );

  return { classifications, reset, merge, remove, rerun, rerunning, error };
}
