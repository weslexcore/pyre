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

/**
 * The box every badge in a row of them shares — signal chips here, and the
 * pages' own status badges — so they come out the same height and centre on
 * the same line. The fixed line height is what makes that hold: without it a
 * chip takes whatever line height it inherits from where it sits.
 */
export const CHIP_CLASS =
  'inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 font-mono text-[10px] leading-4 uppercase tracking-wide';

/** The label chip on its own, for filters and legends. */
export function SignalTypeBadge({ type }: { type: SignalType }) {
  return <span className={`${CHIP_CLASS} ${toneOf(type)}`}>{signalLabel(type)}</span>;
}

function SignalChip({ signal }: { signal: Signal }) {
  const percent = Math.round(signal.probability * 100);
  return (
    <li className="flex" title={`${signalLabel(signal.type)} — ${percent}% likely`}>
      <SignalTypeBadge type={signal.type} />
      <span className="sr-only"> ({percent}% likely)</span>
    </li>
  );
}

/** The AI sparkle: one large four-point star and a small one, in currentColor. */
export function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 18 18"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M7.5 4.5c.55 3.5 2 4.95 5.5 5.5-3.5.55-4.95 2-5.5 5.5-.55-3.5-2-4.95-5.5-5.5 3.5-.55 4.95-2 5.5-5.5Z" />
      <path d="M14 1.5c.25 1.6.9 2.25 2.5 2.5-1.6.25-2.25.9-2.5 2.5-.25-1.6-.9-2.25-2.5-2.5 1.6-.25 2.25-.9 2.5-2.5Z" />
    </svg>
  );
}

/** A set of signals as chips, e.g. what one run found. */
export function SignalList({ signals }: { signals: readonly Signal[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label="Detected">
      {signals.map((signal) => (
        <SignalChip key={signal.type} signal={signal} />
      ))}
    </ul>
  );
}

/**
 * One record's classification, inline: its signals as chips, or where the
 * read stands. Sized to sit in a row of badges (the caller places it and
 * any separator). Draws nothing for a record never classified.
 */
export function SignalChips({
  classification,
}: {
  classification: ClassificationView | undefined;
}) {
  if (!classification) return null;
  const note = 'font-mono text-[10px] leading-4 text-white/40';
  if (classification.state === 'pending') {
    return (
      <span className={note} aria-live="polite">
        Reading…
      </span>
    );
  }
  if (classification.state === 'failed') return <span className={note}>Couldn’t classify</span>;
  if (classification.signals.length === 0) return <span className={note}>Nothing to act on</span>;
  return <SignalList signals={classification.signals} />;
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

/** Ids per poll request; the route's own cap (MAX_IDS) is 100. */
const POLL_CHUNK = 100;

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
        // The route answers up to POLL_CHUNK ids per request; a bulk run can
        // leave hundreds pending, so ask in chunks. A chunk that fails is
        // simply asked again next tick.
        const all = pendingIds.split(',');
        const chunks: string[][] = [];
        for (let i = 0; i < all.length; i += POLL_CHUNK) chunks.push(all.slice(i, i + POLL_CHUNK));
        const answers = await Promise.all(
          chunks.map(async (ids) => {
            const res = await fetch(
              `/api/admin/classifications?subject=${subject}&ids=${encodeURIComponent(ids.join(','))}`
            );
            if (!res.ok) return null;
            const data = (await res.json()) as {
              classifications: Record<string, ClassificationView>;
            };
            return { ids, found: data.classifications };
          })
        );
        const polled = answers.flatMap((a) => (a ? a.ids : []));
        const found: Record<string, ClassificationView> = Object.assign(
          {},
          ...answers.map((a) => a?.found ?? {})
        );
        if (!cancelled && polled.length > 0) {
          for (const id of polled) {
            const fresh = found[id];
            if (fresh && fresh.state !== 'pending') onSettledRef.current?.(id, fresh);
          }
          setClassifications((prev) => {
            const next = { ...prev };
            const now = Date.now();
            for (const id of polled) {
              // Settled, still pending, or — once the server's timeout
              // passes — failed.
              const fresh = found[id];
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

  /**
   * Read one record again. `extra` rides along in the request — the shift
   * notes page passes { suggest: true } so the suggestion agent looks at the
   * note once the read is saved.
   */
  const rerun = useCallback(
    async (id: string, extra?: Record<string, unknown>) => {
      setRerunning(id);
      setError(null);
      try {
        const res = await fetch('/api/admin/classifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...extra, subject, id }),
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

  /**
   * Reclassify many records at once (a bulk run): they all show "Reading…"
   * straight away and settle as the queue works through them. Resolves to
   * how many were queued; throws with the server's reason on failure.
   */
  const rerunMany = useCallback(
    async (ids: readonly string[]): Promise<{ queued: number; missing: number }> => {
      const res = await fetch('/api/admin/classifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, ids }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        classifications?: Record<string, ClassificationView>;
        queued?: number;
        missing?: number;
        error?: string;
      };
      if (!res.ok || !data.classifications) throw new Error(data.error ?? `HTTP ${res.status}`);
      const fresh = data.classifications;
      setClassifications((prev) => ({ ...prev, ...fresh }));
      return { queued: data.queued ?? 0, missing: data.missing ?? 0 };
    },
    [subject]
  );

  return { classifications, reset, merge, remove, rerun, rerunMany, rerunning, error };
}
