import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIGNAL_THRESHOLD,
  isSignalType,
  isSubjectType,
  MAX_CLASSIFY_TEXT,
  parseSignals,
  readStoredSignals,
  SIGNAL_DEFINITIONS,
  SIGNAL_TYPES,
  SUBJECT_DEFINITIONS,
  sanitizeClassifyText,
  signalThreshold,
  signalTypesOf,
} from '../src';

describe('registries', () => {
  it('uses unique snake_case keys', () => {
    for (const keys of [SIGNAL_TYPES, SUBJECT_DEFINITIONS.map((d) => d.key)]) {
      expect(new Set(keys).size).toBe(keys.length);
      for (const key of keys) expect(key).toMatch(/^[a-z][a-z_]*$/);
    }
  });

  it('gives every signal a label, definition, examples, and a sane threshold', () => {
    for (const d of SIGNAL_DEFINITIONS) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.definition.length).toBeGreaterThan(20);
      expect(d.examples.length).toBeGreaterThan(0);
      const threshold = signalThreshold(d.key);
      expect(threshold).toBeGreaterThan(0);
      expect(threshold).toBeLessThan(1);
    }
    expect(signalThreshold('action')).toBe(DEFAULT_SIGNAL_THRESHOLD);
  });

  it('only lets subjects look for known signals', () => {
    for (const s of SUBJECT_DEFINITIONS) {
      for (const type of s.signals) expect(isSignalType(type)).toBe(true);
    }
  });

  it('recognises keys', () => {
    expect(isSignalType('action')).toBe(true);
    expect(isSignalType('nope')).toBe(false);
    expect(isSubjectType('shift_note')).toBe(true);
    expect(isSubjectType('guest')).toBe(false);
  });
});

describe('parseSignals', () => {
  it('keeps what clears each threshold, most likely first', () => {
    expect(
      parseSignals(
        { action: 0.62, question: 0.91, update: 0.1, feedback: 0.49, safety: 0.4 },
        'shift_note'
      )
    ).toEqual({
      ok: true,
      signals: [
        { type: 'question', probability: 0.91 },
        { type: 'action', probability: 0.62 },
        // Safety's lower threshold (0.35) lets 0.4 through; feedback's 0.49 misses 0.5.
        { type: 'safety', probability: 0.4 },
      ],
    });
  });

  it('accepts nothing found, and ignores unknown or missing keys', () => {
    expect(parseSignals({}, 'shift_note')).toEqual({ ok: true, signals: [] });
    expect(parseSignals({ gossip: 0.99, action: 0.2 }, 'shift_note')).toEqual({
      ok: true,
      signals: [],
    });
  });

  it('rejects malformed payloads and out-of-range probabilities', () => {
    expect(parseSignals([], 'shift_note').ok).toBe(false);
    expect(parseSignals(null, 'shift_note').ok).toBe(false);
    expect(parseSignals({ action: 1.2 }, 'shift_note').ok).toBe(false);
    expect(parseSignals({ action: '0.8' }, 'shift_note').ok).toBe(false);
    expect(parseSignals({ action: Number.NaN }, 'shift_note').ok).toBe(false);
  });
});

describe('readStoredSignals', () => {
  it('drops retired types and junk instead of failing', () => {
    expect(
      readStoredSignals([
        { type: 'action', probability: 0.7 },
        { type: 'retired_kind', probability: 0.9 },
        { type: 'question' },
        { type: 'safety', probability: 0.95 },
        'junk',
      ])
    ).toEqual([
      { type: 'safety', probability: 0.95 },
      { type: 'action', probability: 0.7 },
    ]);
    expect(readStoredSignals(null)).toEqual([]);
  });

  it('lists distinct types in order of appearance', () => {
    expect(
      signalTypesOf([
        { type: 'question', probability: 0.9 },
        { type: 'action', probability: 0.8 },
      ])
    ).toEqual(['question', 'action']);
  });
});

describe('sanitizeClassifyText', () => {
  it('strips control characters, trims, and caps', () => {
    expect(sanitizeClassifyText('  Towels low\u0007\n ')).toBe('Towels low');
    expect(sanitizeClassifyText('a'.repeat(MAX_CLASSIFY_TEXT + 500)).length).toBe(MAX_CLASSIFY_TEXT);
  });
});
