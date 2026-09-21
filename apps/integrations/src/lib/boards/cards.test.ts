import { describe, expect, it } from 'vitest';
import type { BoardCardRow, BoardColumnRow } from '@/lib/db';
import { cardsByColumn, columnPatch, defaultColumn, isFinished, nextSortOrder } from './cards';

const NOW = '2026-09-21T12:00:00Z';
const ME = 'wes@pyresauna.com';

const col = (
  id: string,
  kind: BoardColumnRow['kind'],
  sort = 0,
  archived = false
): BoardColumnRow =>
  ({
    id,
    board_id: 'b',
    key: id,
    label: id,
    kind,
    sort_order: sort,
    archived,
    created_at: '',
    updated_at: '',
  }) as BoardColumnRow;

const TODO = col('todo', 'open', 10);
const DOING = col('doing', 'open', 20);
const DONE = col('done', 'done', 30);
const LOST = col('lost', 'dropped', 40);

const card = (over: Partial<BoardCardRow> = {}) => ({
  column_id: 'todo',
  completed_at: null as string | null,
  completed_by: null as string | null,
  waiting_on: null as string | null,
  ...over,
});

describe('columnPatch', () => {
  it('does nothing when the card is already there', () => {
    expect(columnPatch(card({ column_id: 'todo' }), TODO, ME, NOW)).toBeNull();
  });

  it('stamps completion on the way into a done column', () => {
    expect(columnPatch(card(), DONE, ME, NOW)).toEqual({
      column_id: 'done',
      completed_at: NOW,
      completed_by: ME,
      waiting_on: null,
    });
  });

  it('stamps a dropped column too — finished is finished', () => {
    expect(columnPatch(card(), LOST, ME, NOW)).toMatchObject({
      completed_at: NOW,
      completed_by: ME,
    });
  });

  it('clears the waiting-on badge when a card finishes', () => {
    const waiting = card({ waiting_on: "Sarah's availability" });
    expect(columnPatch(waiting, DONE, ME, NOW)?.waiting_on).toBeNull();
  });

  it('keeps the badge on a move between open columns', () => {
    const waiting = card({ waiting_on: "Sarah's availability" });
    expect(columnPatch(waiting, DOING, ME, NOW)?.waiting_on).toBe("Sarah's availability");
  });

  it('clears the stamp when a card is pulled back out of Done', () => {
    const done = card({ column_id: 'done', completed_at: NOW, completed_by: ME });
    expect(columnPatch(done, TODO, ME, NOW)).toMatchObject({
      column_id: 'todo',
      completed_at: null,
      completed_by: null,
    });
  });

  it('keeps the original credit when a card moves between finished columns', () => {
    const earlier = '2026-05-01T09:00:00Z';
    const done = card({
      column_id: 'done',
      completed_at: earlier,
      completed_by: 'maya@pyresauna.com',
    });
    expect(columnPatch(done, LOST, ME, NOW)).toMatchObject({
      completed_at: earlier,
      completed_by: 'maya@pyresauna.com',
    });
  });
});

describe('isFinished', () => {
  const columns = new Map([TODO, DONE, LOST].map((c) => [c.id, c]));
  it('reads the column kind, and assumes not finished when it is missing', () => {
    expect(isFinished({ column_id: 'todo' }, columns)).toBe(false);
    expect(isFinished({ column_id: 'done' }, columns)).toBe(true);
    expect(isFinished({ column_id: 'lost' }, columns)).toBe(true);
    expect(isFinished({ column_id: 'gone' }, columns)).toBe(false);
  });
});

describe('cardsByColumn', () => {
  const cards = [
    { column_id: 'doing', sort_order: 10, created_at: '2026-01-02' },
    { column_id: 'todo', sort_order: 20, created_at: '2026-01-01' },
    { column_id: 'todo', sort_order: 10, created_at: '2026-01-03' },
  ];

  it('groups in column order, cards in hand order', () => {
    const grouped = cardsByColumn([DOING, TODO, DONE], cards);
    expect(grouped.map((g) => g.column.id)).toEqual(['todo', 'doing', 'done']);
    expect(grouped[0].cards.map((c) => c.sort_order)).toEqual([10, 20]);
    expect(grouped[2].cards).toEqual([]);
  });

  it('hides an archived column once it is empty, and keeps one that is not', () => {
    const retired = col('retired', 'open', 5, true);
    expect(cardsByColumn([retired, TODO], cards).map((g) => g.column.id)).toEqual(['todo']);
    const stranded = [...cards, { column_id: 'retired', sort_order: 0, created_at: '2026-01-04' }];
    expect(cardsByColumn([retired, TODO], stranded).map((g) => g.column.id)).toEqual([
      'retired',
      'todo',
    ]);
  });
});

describe('nextSortOrder', () => {
  it('appends after everything in that column', () => {
    const cards = [
      { column_id: 'todo', sort_order: 10 },
      { column_id: 'todo', sort_order: 30 },
      { column_id: 'doing', sort_order: 90 },
    ];
    expect(nextSortOrder(cards, 'todo')).toBe(40);
    expect(nextSortOrder(cards, 'doing')).toBe(100);
    expect(nextSortOrder(cards, 'done')).toBe(10);
  });
});

describe('defaultColumn', () => {
  it('drops a quick-add in the first open column', () => {
    expect(defaultColumn([DONE, DOING, TODO])?.id).toBe('todo');
  });

  it('falls back to any live column on a board with no open one', () => {
    expect(defaultColumn([DONE, LOST])?.id).toBe('done');
    expect(defaultColumn([])).toBeNull();
  });
});
