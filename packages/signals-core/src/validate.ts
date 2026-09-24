// The payload rules for a classification: what the agent's save tool accepts
// and what the integrations app will store. Both sides import these so the
// limits cannot drift apart.

import { isSignalType, type Signal, type SignalType } from './signals';
import { type SubjectType, subjectDefinition } from './subjects';

/** Signals per classification. A short note rarely carries more than three or four. */
export const MAX_SIGNALS = 10;

/** One line of summary per signal. */
export const MAX_SIGNAL_SUMMARY = 200;

export type ParseSignalsResult = { ok: true; signals: Signal[] } | { ok: false; error: string };

function cleanSummary(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Validate signals from an untrusted source (the agent's save call) for a
 * subject: known keys that apply to that subject, a non-empty one-line
 * summary each, at most MAX_SIGNALS. Exact duplicates collapse into one.
 * An empty list is valid — "nothing to act on" is a result too.
 */
export function parseSignals(raw: unknown, subject: SubjectType): ParseSignalsResult {
  if (!Array.isArray(raw)) return { ok: false, error: 'signals must be an array' };
  if (raw.length > MAX_SIGNALS) {
    return { ok: false, error: `at most ${MAX_SIGNALS} signals per classification` };
  }
  const allowed = new Set<string>(subjectDefinition(subject).signals);
  const seen = new Set<string>();
  const signals: Signal[] = [];
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, error: `signals[${index}] must be an object` };
    }
    const { type, summary: rawSummary } = entry as Record<string, unknown>;
    if (!isSignalType(type) || !allowed.has(type)) {
      return {
        ok: false,
        error: `signals[${index}].type must be one of ${[...allowed].join(', ')}`,
      };
    }
    const summary = cleanSummary(rawSummary);
    if (!summary || summary.length > MAX_SIGNAL_SUMMARY) {
      return {
        ok: false,
        error: `signals[${index}].summary must be 1–${MAX_SIGNAL_SUMMARY} characters`,
      };
    }
    const key = `${type}\u0000${summary.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    signals.push({ type, summary });
  }
  return { ok: true, signals };
}

/**
 * Signals read back from storage, leniently: entries under a key this build
 * no longer knows (a retired signal type) are dropped instead of failing the
 * whole read.
 */
export function readStoredSignals(raw: unknown): Signal[] {
  if (!Array.isArray(raw)) return [];
  const signals: Signal[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { type, summary } = entry as Record<string, unknown>;
    const text = cleanSummary(summary);
    if (isSignalType(type) && text) signals.push({ type, summary: text });
  }
  return signals;
}

/** The distinct signal types in a list, in order of first appearance. */
export function signalTypesOf(signals: readonly Signal[]): SignalType[] {
  return [...new Set(signals.map((s) => s.type))];
}
