import { describe, expect, it } from 'vitest';
import { diffLines, diffSummary } from './diff';

describe('diffLines', () => {
  it('returns all-same for identical inputs', () => {
    const lines = diffLines('a\nb', 'a\nb');
    expect(lines).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'b' },
    ]);
  });

  it('marks an inserted line as added', () => {
    const lines = diffLines('a\nc', 'a\nb\nc');
    expect(lines).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'added', text: 'b' },
      { kind: 'same', text: 'c' },
    ]);
  });

  it('marks a deleted line as removed', () => {
    const lines = diffLines('a\nb\nc', 'a\nc');
    expect(lines).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'same', text: 'c' },
    ]);
  });

  it('treats a changed line as remove + add', () => {
    const lines = diffLines('- [ ] old task', '- [ ] new task');
    expect(lines).toEqual([
      { kind: 'removed', text: '- [ ] old task' },
      { kind: 'added', text: '- [ ] new task' },
    ]);
  });

  it('handles empty documents', () => {
    expect(diffLines('', '')).toEqual([{ kind: 'same', text: '' }]);
    expect(diffLines('', 'a').filter((l) => l.kind === 'added')).toEqual([
      { kind: 'added', text: 'a' },
    ]);
  });
});

describe('diffSummary', () => {
  it('is null when nothing changed', () => {
    expect(diffSummary('a\nb', 'a\nb')).toBeNull();
  });

  it('counts added and removed lines', () => {
    expect(diffSummary('a\nb', 'a\nc\nd')).toBe('+2 −1');
  });
});
