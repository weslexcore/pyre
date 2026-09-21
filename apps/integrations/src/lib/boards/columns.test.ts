import { describe, expect, it } from 'vitest';
import {
  appendColumn,
  columnKeyOf,
  columnsPayload,
  isLastOpenColumn,
  removeColumn,
  renameColumn,
} from './columns';

const column = (key: string, sort: number, over: Record<string, unknown> = {}) => ({
  key,
  label: key,
  kind: 'open' as const,
  archived: false,
  sort_order: sort,
  ...over,
});

describe('columnKeyOf', () => {
  it('turns a label into a key the constraint accepts', () => {
    expect(columnKeyOf('Follow up', [])).toBe('follow_up');
    expect(columnKeyOf('  Quoted & sent!  ', [])).toBe('quoted_sent');
    expect(columnKeyOf('In progress', [])).toBe('in_progress');
  });

  it('prefixes a key that would start with a digit', () => {
    expect(columnKeyOf('2nd call', [])).toBe('c_2nd_call');
  });

  it('finds something to say for a label of only punctuation', () => {
    expect(columnKeyOf('???', [])).toBe('column');
  });

  it('takes the next free suffix on a collision', () => {
    expect(columnKeyOf('New', ['new'])).toBe('new_2');
    expect(columnKeyOf('New', ['new', 'new_2'])).toBe('new_3');
  });

  it('stays inside the key limit with room for a suffix', () => {
    const key = columnKeyOf('x'.repeat(80), []);
    expect(key.length).toBeLessThanOrEqual(36);
    expect(columnKeyOf('x'.repeat(80), [key]).length).toBeLessThanOrEqual(40);
  });
});

describe('columnsPayload', () => {
  it('sorts by sort order and renames the fields the route wants', () => {
    expect(columnsPayload([column('done', 30), column('new', 10)])).toEqual([
      { key: 'new', label: 'new', kind: 'open', archived: false, sortOrder: 10 },
      { key: 'done', label: 'done', kind: 'open', archived: false, sortOrder: 30 },
    ]);
  });
});

describe('renameColumn', () => {
  it('changes one label and nothing else', () => {
    const next = renameColumn([column('new', 10), column('done', 20)], 'new', 'Fresh');
    expect(next.map((c) => c.key)).toEqual(['new', 'done']);
    expect(next[0].label).toBe('Fresh');
    expect(next[1].label).toBe('done');
  });
});

describe('appendColumn', () => {
  it('adds an open column after the last one with a key from its label', () => {
    const next = appendColumn([column('new', 10), column('done', 30)], 'Follow up');
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual({
      key: 'follow_up',
      label: 'Follow up',
      kind: 'open',
      archived: false,
      sortOrder: 40,
    });
  });

  it('never reuses a key already on the board, retired or not', () => {
    const next = appendColumn([column('new', 10, { archived: true })], 'New', 'done');
    expect(next[1]).toMatchObject({ key: 'new_2', kind: 'done', sortOrder: 20 });
  });
});

describe('removeColumn / isLastOpenColumn', () => {
  it('drops one column and keeps the rest in order', () => {
    const next = removeColumn([column('new', 10), column('old', 20), column('done', 30)], 'old');
    expect(next.map((c) => c.key)).toEqual(['new', 'done']);
  });

  it('knows when a column is the last place a card could go', () => {
    const done = column('done', 20, { kind: 'done' });
    expect(isLastOpenColumn([column('new', 10), done], 'new')).toBe(true);
    expect(isLastOpenColumn([column('new', 10), column('doing', 15), done], 'new')).toBe(false);
    // A retired open column does not count as somewhere to put a card.
    expect(isLastOpenColumn([column('new', 10), column('old', 5, { archived: true })], 'new')).toBe(
      true
    );
    expect(isLastOpenColumn([column('new', 10), done], 'done')).toBe(false);
  });
});
