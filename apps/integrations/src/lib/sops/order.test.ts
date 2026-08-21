import { describe, expect, it } from 'vitest';
import {
  categoriesInOrder,
  moveSopToCategoryEnd,
  repositionCategory,
  repositionSop,
  sectionsInOrder,
  sortSops,
} from './order';

const sop = (category: string, sort_order: number, title: string) => ({
  category,
  sort_order,
  title,
});

describe('sortSops', () => {
  it('orders categories by rank, not alphabetically', () => {
    const sorted = sortSops(
      [sop('Closing', 0, 'Break Down'), sop('Opening', 0, 'Full Setup')],
      [
        { name: 'Opening', sort_order: 0 },
        { name: 'Closing', sort_order: 1 },
      ]
    );
    expect(sorted.map((s) => s.category)).toEqual(['Opening', 'Closing']);
  });

  it('sends unranked categories to the end, alphabetically', () => {
    const sorted = sortSops(
      [sop('Zeta', 0, 'z'), sop('Alpha', 0, 'a'), sop('Closing', 0, 'c')],
      [{ name: 'Closing', sort_order: 5 }]
    );
    expect(sorted.map((s) => s.category)).toEqual(['Closing', 'Alpha', 'Zeta']);
  });

  it('orders within a category by sort_order then title', () => {
    const sorted = sortSops(
      [sop('Opening', 2, 'B'), sop('Opening', 1, 'C'), sop('Opening', 2, 'A')],
      [{ name: 'Opening', sort_order: 0 }]
    );
    expect(sorted.map((s) => s.title)).toEqual(['C', 'A', 'B']);
  });

  it('does not mutate the input array', () => {
    const input = [sop('B', 0, 'b'), sop('A', 0, 'a')];
    sortSops(input, []);
    expect(input.map((s) => s.category)).toEqual(['B', 'A']);
  });
});

describe('sectionsInOrder', () => {
  it('keeps sections that hold no documents', () => {
    expect(
      sectionsInOrder(
        [
          { name: 'Opening', sort_order: 0 },
          { name: 'Maintenance', sort_order: 1 },
          { name: 'Closing', sort_order: 2 },
        ],
        [sop('Opening', 0, 'a'), sop('Closing', 0, 'b')]
      )
    ).toEqual(['Opening', 'Maintenance', 'Closing']);
  });

  it('appends categories used by documents but never ranked, alphabetically', () => {
    expect(
      sectionsInOrder(
        [{ name: 'Opening', sort_order: 0 }],
        [sop('Zeta', 0, 'z'), sop('Opening', 0, 'a'), sop('Alpha', 0, 'b')]
      )
    ).toEqual(['Opening', 'Alpha', 'Zeta']);
  });

  it('breaks ties between equal ranks by name, matching sortSops', () => {
    expect(
      sectionsInOrder(
        [
          { name: 'Beta', sort_order: 0 },
          { name: 'Alpha', sort_order: 0 },
        ],
        []
      )
    ).toEqual(['Alpha', 'Beta']);
  });

  it('never repeats a section named by both a rank and a document', () => {
    expect(sectionsInOrder([{ name: 'Opening', sort_order: 0 }], [sop('Opening', 0, 'a')])).toEqual(
      ['Opening']
    );
  });
});

describe('categoriesInOrder', () => {
  it('returns unique categories in first-seen order', () => {
    expect(
      categoriesInOrder([sop('Opening', 0, 'a'), sop('Closing', 0, 'b'), sop('Opening', 1, 'c')])
    ).toEqual(['Opening', 'Closing']);
  });
});

const doc = (id: string, category: string) => ({ id, category });

describe('repositionSop', () => {
  const list = [doc('a', 'Opening'), doc('b', 'Opening'), doc('c', 'Closing')];

  it('dragging down lands after the target', () => {
    expect(repositionSop(list, 'a', 'b').map((s) => s.id)).toEqual(['b', 'a', 'c']);
  });

  it('dragging up lands before the target', () => {
    expect(repositionSop(list, 'b', 'a').map((s) => s.id)).toEqual(['b', 'a', 'c']);
  });

  it('adopts the target category when dragged into another section', () => {
    const next = repositionSop(list, 'a', 'c');
    expect(next.map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect(next.find((s) => s.id === 'a')?.category).toBe('Closing');
  });

  it('is a no-op on self or unknown ids', () => {
    expect(repositionSop(list, 'a', 'a')).toBe(list);
    expect(repositionSop(list, 'a', 'nope')).toBe(list);
  });
});

describe('moveSopToCategoryEnd', () => {
  const list = [doc('a', 'Opening'), doc('b', 'Opening'), doc('c', 'Closing')];

  it('moves to the end of the target category, changing category', () => {
    const next = moveSopToCategoryEnd(list, 'a', 'Closing');
    expect(next.map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect(next[2].category).toBe('Closing');
  });

  it('moves into an empty category at the end of the list', () => {
    const next = moveSopToCategoryEnd(list, 'a', 'Misc');
    expect(next.map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect(next[2].category).toBe('Misc');
  });

  it('is a no-op when already last in that category', () => {
    expect(moveSopToCategoryEnd(list, 'b', 'Opening')).toBe(list);
  });
});

describe('repositionCategory', () => {
  it('moves a category to the target position in both directions', () => {
    expect(repositionCategory(['A', 'B', 'C'], 'A', 'C')).toEqual(['B', 'C', 'A']);
    expect(repositionCategory(['A', 'B', 'C'], 'C', 'A')).toEqual(['C', 'A', 'B']);
  });

  it('is a no-op on self or unknown names', () => {
    const list = ['A', 'B'];
    expect(repositionCategory(list, 'A', 'A')).toBe(list);
    expect(repositionCategory(list, 'A', 'nope')).toBe(list);
  });
});
