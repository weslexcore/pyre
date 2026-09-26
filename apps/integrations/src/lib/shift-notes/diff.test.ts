import { describe, expect, it } from 'vitest';
import { diffWords } from './diff';

const join = (segments: ReturnType<typeof diffWords>, keep: 'before' | 'after') =>
  segments
    .filter((s) => s.op === 'same' || s.op === (keep === 'before' ? 'del' : 'add'))
    .map((s) => s.text)
    .join('');

describe('diffWords', () => {
  it('marks the words swapped in one spot and keeps the rest as context', () => {
    expect(diffWords('Towels are low tonight', 'Towels are out tonight')).toEqual([
      { op: 'same', text: 'Towels are ' },
      { op: 'del', text: 'low' },
      { op: 'add', text: 'out' },
      { op: 'same', text: ' tonight' },
    ]);
  });

  it('handles additions at either end', () => {
    expect(diffWords('Heater is out', 'Left heater is out')).toEqual([
      { op: 'del', text: 'Heater' },
      { op: 'add', text: 'Left heater' },
      { op: 'same', text: ' is out' },
    ]);
    expect(diffWords('Heater is out', 'Heater is out and Sam is coming')).toEqual([
      { op: 'same', text: 'Heater is out' },
      { op: 'add', text: ' and Sam is coming' },
    ]);
  });

  it('always rebuilds both texts exactly', () => {
    const pairs: Array<[string, string]> = [
      ['', 'New note'],
      ['Old note', ''],
      ['a b c d e', 'a c e f'],
      ['same', 'same'],
      ['line one\nline two', 'line one\n\nline two and three'],
    ];
    for (const [before, after] of pairs) {
      const segments = diffWords(before, after);
      expect(join(segments, 'before')).toBe(before);
      expect(join(segments, 'after')).toBe(after);
    }
  });

  it('falls back to a whole replace past the size cap', () => {
    const before = Array.from({ length: 1200 }, (_, i) => `a${i}`).join(' ');
    const after = Array.from({ length: 1200 }, (_, i) => `b${i}`).join(' ');
    const segments = diffWords(before, after);
    expect(segments.map((s) => s.op)).toEqual(['del', 'add']);
    expect(join(segments, 'after')).toBe(after);
  });
});
