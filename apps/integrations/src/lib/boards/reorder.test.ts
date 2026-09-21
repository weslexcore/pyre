import { describe, expect, it } from 'vitest';
import { planDrop, sortOrdersFor } from './reorder';

const card = (id: string, column_id: string, sort_order: number) => ({
  id,
  column_id,
  sort_order,
  created_at: '2026-09-01T00:00:00Z',
});
const cards = [
  card('a', 'todo', 10),
  card('b', 'todo', 20),
  card('c', 'todo', 30),
  card('x', 'done', 10),
];
const columns = [
  { id: 'todo', archived: false },
  { id: 'done', archived: false },
  { id: 'old', archived: true },
];

describe('planDrop', () => {
  it('moves a card up its column onto the one it was dropped on', () => {
    expect(planDrop({ activeId: 'c', overId: 'a' }, cards, columns)).toMatchObject({
      columnId: 'todo',
      moved: false,
      orderedIds: ['c', 'a', 'b'],
    });
  });

  it('moves a card down its column past the one it was dropped on', () => {
    expect(planDrop({ activeId: 'a', overId: 'c' }, cards, columns)?.orderedIds).toEqual([
      'b',
      'c',
      'a',
    ]);
    expect(planDrop({ activeId: 'a', overId: 'b' }, cards, columns)?.orderedIds).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('drops onto another column, at the end or at a card', () => {
    expect(planDrop({ activeId: 'b', overId: 'done' }, cards, columns)).toMatchObject({
      columnId: 'done',
      moved: true,
      orderedIds: ['x', 'b'],
    });
    expect(planDrop({ activeId: 'b', overId: 'x' }, cards, columns)?.orderedIds).toEqual([
      'b',
      'x',
    ]);
  });

  it('is nothing when the drop changes nothing', () => {
    expect(planDrop({ activeId: 'a', overId: 'a' }, cards, columns)).toBeNull();
    expect(planDrop({ activeId: 'c', overId: 'todo' }, cards, columns)).toBeNull();
    expect(planDrop({ activeId: 'a', overId: null }, cards, columns)).toBeNull();
    expect(planDrop({ activeId: 'ghost', overId: 'done' }, cards, columns)).toBeNull();
  });

  it('refuses an archived column it is not already in', () => {
    expect(planDrop({ activeId: 'a', overId: 'old' }, cards, columns)).toBeNull();
    const parked = [...cards, card('p', 'old', 10), card('q', 'old', 20)];
    expect(planDrop({ activeId: 'q', overId: 'p' }, parked, columns)?.orderedIds).toEqual([
      'q',
      'p',
    ]);
  });
});

describe('sortOrdersFor', () => {
  it('numbers ten apart from the top', () => {
    expect([...sortOrdersFor(['b', 'a'])]).toEqual([
      ['b', 10],
      ['a', 20],
    ]);
  });
});
