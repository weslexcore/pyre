// The rules for a classification's answers: which of Jev's probabilities
// count as signals (classifySignals), and how stored signals read back.

import { isSignalType, type Signal, type SignalType, signalThreshold } from './signals';
import { type SubjectType, subjectDefinition } from './subjects';

export type ParseSignalsResult = { ok: true; signals: Signal[] } | { ok: false; error: string };

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Validate Jev's answers for a subject: a probability in [0, 1] for each
 * signal type that applies to the subject, keyed by type. Returns the signals
 * at or above their thresholds, most likely first. An empty list is valid —
 * "nothing to act on" is a result too. Keys for other types are ignored.
 */
export function parseSignals(raw: unknown, subject: SubjectType): ParseSignalsResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'probabilities must be an object keyed by signal type' };
  }
  const probabilities = raw as Record<string, unknown>;
  const signals: Signal[] = [];
  for (const type of subjectDefinition(subject).signals) {
    const probability = probabilities[type];
    if (probability === undefined) continue;
    if (!isProbability(probability)) {
      return { ok: false, error: `probabilities.${type} must be a number in [0, 1]` };
    }
    if (probability >= signalThreshold(type)) signals.push({ type, probability });
  }
  return { ok: true, signals: sortSignals(signals) };
}

function sortSignals(signals: Signal[]): Signal[] {
  return signals.sort((a, b) => b.probability - a.probability);
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
    const { type, probability } = entry as Record<string, unknown>;
    if (isSignalType(type) && isProbability(probability)) signals.push({ type, probability });
  }
  return sortSignals(signals);
}

/** The distinct signal types in a list, in order of first appearance. */
export function signalTypesOf(signals: readonly Signal[]): SignalType[] {
  return [...new Set(signals.map((s) => s.type))];
}
