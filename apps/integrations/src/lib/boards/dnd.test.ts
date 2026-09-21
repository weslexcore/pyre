import { describe, expect, it } from 'vitest';
import { droppedColumn } from '@/components/admin/boards/dnd';

const cards = [{ id: 'c1', column_id: 'todo' }];
const columns = [
  { id: 'todo', archived: false },
  { id: 'done', archived: false },
  { id: 'old', archived: true },
];
const drop = (active: string, over: string | null) =>
  ({ active: { id: active }, over: over ? { id: over } : null }) as never;

describe('droppedColumn', () => {
  it('names the card and the column it landed in', () => {
    expect(droppedColumn(drop('c1', 'done'), cards, columns)).toEqual({
      card: cards[0],
      columnId: 'done',
    });
  });

  it('is nothing when the card was dropped where it already was, or nowhere', () => {
    expect(droppedColumn(drop('c1', 'todo'), cards, columns)).toBeNull();
    expect(droppedColumn(drop('c1', null), cards, columns)).toBeNull();
    expect(droppedColumn(drop('ghost', 'done'), cards, columns)).toBeNull();
  });

  it('refuses a retired column', () => {
    expect(droppedColumn(drop('c1', 'old'), cards, columns)).toBeNull();
  });
});
