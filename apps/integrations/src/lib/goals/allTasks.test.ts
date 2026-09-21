import { describe, expect, it } from 'vitest';
import type { BoardCardRow, BoardColumnRow, BoardRow } from '@/lib/db';
import { buildAllTasks, weekLabel } from './allTasks';

// 2026-09-21 is a Monday, so "this week" runs to Sunday the 27th.
const TODAY = '2026-09-21';

const column = (id: string, kind: BoardColumnRow['kind']): BoardColumnRow =>
  ({
    id,
    board_id: 'tasks',
    key: id,
    label: id,
    kind,
    sort_order: 0,
    archived: false,
    created_at: '',
    updated_at: '',
  }) as BoardColumnRow;

const COLUMNS = [column('todo', 'open'), column('done', 'done'), column('lost', 'dropped')];

const board = (id: string, slug: string, include: boolean, sort = 0): BoardRow =>
  ({
    id,
    slug,
    name: slug,
    description: '',
    card_noun: 'task',
    include_in_all_tasks: include,
    sort_order: sort,
    archived: false,
    created_by: null,
    updated_by: null,
    created_at: '',
    updated_at: '',
  }) as BoardRow;

const BOARDS = [board('tasks', 'goals', true, 10), board('leads', 'rentals', false, 20)];

let seq = 0;
const nextId = () => {
  seq += 1;
  return `card-${seq}`;
};
const card = (over: Partial<BoardCardRow> = {}): BoardCardRow =>
  ({
    id: nextId(),
    board_id: 'tasks',
    column_id: 'todo',
    goal_id: null,
    title: 'a task',
    notes_md: '',
    owner_email: null,
    due_date: null,
    waiting_on: null,
    area: null,
    sort_order: 0,
    properties: {},
    source: 'manual',
    external_ref: null,
    completed_at: null,
    completed_by: null,
    created_by: 'wes@pyresauna.com',
    updated_by: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  }) as BoardCardRow;

const options = { today: TODAY, viewerEmail: 'wes@pyresauna.com', groupBy: 'board' as const };

describe('buildAllTasks', () => {
  it('lists only boards that opted in', () => {
    const cards = [card({ board_id: 'tasks' }), card({ board_id: 'leads' })];
    const built = buildAllTasks(cards, BOARDS, COLUMNS, {}, options);
    expect(built.unfiled).toHaveLength(1);
    expect(built.unfiled[0].board_id).toBe('tasks');
  });

  it('puts finished cards only under Recently done', () => {
    const open = card({ column_id: 'todo' });
    const done = card({ column_id: 'done', completed_at: '2026-09-16T10:00:00Z' });
    const dropped = card({ column_id: 'lost', completed_at: '2026-09-16T11:00:00Z' });
    const built = buildAllTasks([open, done, dropped], BOARDS, COLUMNS, {}, options);

    expect(built.unfiled.map((c) => c.id)).toEqual([open.id]);
    expect(built.overdue).toHaveLength(0);
    expect(built.recentlyDone).toHaveLength(1);
    expect(built.recentlyDone[0].weekStart).toBe('2026-09-14');
    expect(built.recentlyDone[0].cards.map((c) => c.id).sort()).toEqual(
      [done.id, dropped.id].sort()
    );
  });

  it('does not call today overdue', () => {
    const yesterday = card({ due_date: '2026-09-20' });
    const today = card({ due_date: TODAY });
    const sunday = card({ due_date: '2026-09-27' });
    const nextWeek = card({ due_date: '2026-09-28' });
    const built = buildAllTasks([yesterday, today, sunday, nextWeek], BOARDS, COLUMNS, {}, options);

    expect(built.overdue.map((c) => c.id)).toEqual([yesterday.id]);
    expect(built.dueThisWeek.map((c) => c.id)).toEqual([today.id, sunday.id]);
  });

  it('keeps unfiled chores out of the board groups and in their own section', () => {
    const filed = card({ goal_id: 'g1' });
    const chore = card({ goal_id: null });
    const built = buildAllTasks([filed, chore], BOARDS, COLUMNS, {}, options);

    expect(built.groups).toHaveLength(1);
    expect(built.groups[0]).toMatchObject({ key: 'tasks', label: 'goals', boardSlug: 'goals' });
    expect(built.groups[0].cards.map((c) => c.id)).toEqual([filed.id, chore.id]);
    expect(built.unfiled.map((c) => c.id)).toEqual([chore.id]);
  });

  it('puts the viewer first and Unassigned last', () => {
    const people = { 'wes@pyresauna.com': 'Wes', 'julien@pyresauna.com': 'Julien' };
    const built = buildAllTasks(
      [
        card({ owner_email: 'julien@pyresauna.com' }),
        card({ owner_email: null }),
        card({ owner_email: 'wes@pyresauna.com' }),
      ],
      BOARDS,
      COLUMNS,
      people,
      { ...options, groupBy: 'owner' }
    );
    expect(built.groups.map((g) => g.label)).toEqual(['Wes', 'Julien', 'Unassigned']);
  });

  it('groups by board in board order', () => {
    const boards = [board('tasks', 'goals', true, 20), board('chores', 'chores', true, 10)];
    const built = buildAllTasks(
      [card({ board_id: 'tasks' }), card({ board_id: 'chores' })],
      boards,
      [...COLUMNS, { ...column('todo', 'open'), board_id: 'chores' }],
      {},
      { ...options, groupBy: 'board' }
    );
    expect(built.groups.map((g) => g.boardSlug)).toEqual(['chores', 'goals']);
  });

  it('sorts each strip by due date, undated last', () => {
    const late = card({ due_date: '2026-09-19' });
    const later = card({ due_date: '2026-09-20' });
    const undated = card({ due_date: null });
    const built = buildAllTasks([undated, later, late], BOARDS, COLUMNS, {}, options);
    expect(built.unfiled.map((c) => c.due_date)).toEqual(['2026-09-19', '2026-09-20', null]);
  });

  it('treats a card whose column vanished as open, not as done', () => {
    const orphan = card({ column_id: 'gone' });
    const built = buildAllTasks([orphan], BOARDS, COLUMNS, {}, options);
    expect(built.unfiled.map((c) => c.id)).toEqual([orphan.id]);
    expect(built.recentlyDone).toHaveLength(0);
  });

  it('splits the done pile by week, newest first', () => {
    const built = buildAllTasks(
      [
        card({ column_id: 'done', completed_at: '2026-09-15T10:00:00Z' }),
        card({ column_id: 'done', completed_at: '2026-09-08T10:00:00Z' }),
      ],
      BOARDS,
      COLUMNS,
      {},
      options
    );
    expect(built.recentlyDone.map((w) => w.weekStart)).toEqual(['2026-09-14', '2026-09-07']);
  });
});

describe('weekLabel', () => {
  it('heads a week by its Monday', () => {
    expect(weekLabel('2026-09-14')).toBe('Week of 14 Sep');
  });
});
