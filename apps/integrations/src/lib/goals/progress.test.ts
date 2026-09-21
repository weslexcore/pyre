import { describe, expect, it } from 'vitest';
import {
  daysLeft,
  formatDaysLeft,
  goalRollup,
  isCardOpen,
  paceState,
  taskProgress,
} from './progress';

const columns = new Map([
  ['todo', { kind: 'open' as const }],
  ['doing', { kind: 'open' as const }],
  ['done', { kind: 'done' as const }],
  ['lost', { kind: 'dropped' as const }],
]);

const TODAY = '2026-09-21';

describe('taskProgress', () => {
  it('counts by the kind of column a card sits in', () => {
    const progress = taskProgress(
      [
        { column_id: 'todo' },
        { column_id: 'doing' },
        { column_id: 'done' },
        { column_id: 'done' },
        { column_id: 'lost' },
      ],
      columns
    );
    expect(progress).toEqual({ total: 5, done: 2, dropped: 1, open: 2, pct: 40 });
  });

  it('reads an empty goal as 0, not as finished', () => {
    expect(taskProgress([], columns)).toEqual({ total: 0, done: 0, dropped: 0, open: 0, pct: 0 });
  });

  it('keeps dropped cards in the denominator', () => {
    // Abandoning half the plan is not the same as finishing it.
    expect(taskProgress([{ column_id: 'done' }, { column_id: 'lost' }], columns).pct).toBe(50);
  });
});

describe('daysLeft', () => {
  it('counts forward and backward from today', () => {
    expect(daysLeft('2026-09-28', TODAY)).toBe(7);
    expect(daysLeft('2026-09-21', TODAY)).toBe(0);
    expect(daysLeft('2026-09-18', TODAY)).toBe(-3);
    expect(daysLeft(null, TODAY)).toBeNull();
  });
});

describe('paceState', () => {
  const running = {
    status: 'active' as const,
    started_at: '2026-09-01T00:00:00Z',
    target_date: '2026-10-01',
  };

  it('says nothing without a target date', () => {
    expect(paceState({ ...running, target_date: null }, 50, TODAY)).toBe('none');
  });

  it('says nothing without a start — a deadline alone is not a pace', () => {
    expect(paceState({ ...running, started_at: null }, 50, TODAY)).toBe('none');
  });

  it('bands progress against time spent', () => {
    // 21 of 31 days gone ≈ 68% expected.
    expect(paceState(running, 90, TODAY)).toBe('ahead');
    expect(paceState(running, 68, TODAY)).toBe('on_track');
    expect(paceState(running, 55, TODAY)).toBe('on_track');
    expect(paceState(running, 20, TODAY)).toBe('behind');
  });

  it('lets overdue beat behind — and beat ahead', () => {
    const late = { ...running, target_date: '2026-09-20' };
    expect(paceState(late, 10, TODAY)).toBe('overdue');
    expect(paceState(late, 95, TODAY)).toBe('overdue');
  });

  it('lets a closed goal beat everything', () => {
    const late = { ...running, target_date: '2026-09-01' };
    expect(paceState({ ...late, status: 'completed' }, 10, TODAY)).toBe('done');
    expect(paceState({ ...late, status: 'dropped' }, 10, TODAY)).toBe('done');
  });
});

describe('goalRollup', () => {
  const goal = {
    id: 'parent',
    status: 'active' as const,
    started_at: '2026-09-01T00:00:00Z',
    target_date: '2026-10-01',
  };
  const child = { id: 'child' };

  const cards = [
    { goal_id: 'parent', column_id: 'done' },
    { goal_id: 'parent', column_id: 'todo' },
    { goal_id: 'child', column_id: 'done' },
    { goal_id: 'other', column_id: 'done' },
    { goal_id: null, column_id: 'todo' },
  ];

  const kpis = [
    {
      goal_id: 'parent',
      direction: 'at_least' as const,
      start_value: 0,
      target_value: 4,
      current_value: 4,
    },
    {
      goal_id: 'child',
      direction: 'at_least' as const,
      start_value: 0,
      target_value: 10,
      current_value: 5,
    },
    {
      goal_id: 'other',
      direction: 'at_least' as const,
      start_value: 0,
      target_value: 4,
      current_value: 0,
    },
  ];

  it("counts its children's tasks and KPIs as its own", () => {
    const rollup = goalRollup(goal, [child], cards, kpis, columns, TODAY);
    expect(rollup.tasks).toMatchObject({ total: 3, done: 2, open: 1 });
    expect(rollup.kpis).toMatchObject({ total: 2, met: 1 });
    expect(rollup.childCount).toBe(1);
  });

  it('ignores cards and KPIs belonging to other goals', () => {
    const rollup = goalRollup(goal, [], cards, kpis, columns, TODAY);
    expect(rollup.tasks.total).toBe(2);
    expect(rollup.kpis.total).toBe(1);
  });

  it('judges pace on the KPIs when there are any, on the tasks when not', () => {
    // KPIs at 100% with 21 of 31 days gone is ahead.
    expect(goalRollup(goal, [], cards, kpis, columns, TODAY).pace).toBe('ahead');
    // Without KPIs, 1 of 2 tasks done is 50% against ~68% expected: behind.
    expect(goalRollup(goal, [], cards, [], columns, TODAY).pace).toBe('behind');
  });

  it('carries the days left through', () => {
    expect(goalRollup(goal, [], cards, kpis, columns, TODAY).daysLeft).toBe(10);
  });
});

describe('formatDaysLeft', () => {
  it('reads as English', () => {
    expect(formatDaysLeft(0)).toBe('today');
    expect(formatDaysLeft(1)).toBe('tomorrow');
    expect(formatDaysLeft(-1)).toBe('yesterday');
    expect(formatDaysLeft(12)).toBe('in 12 days');
    expect(formatDaysLeft(-3)).toBe('3 days ago');
    expect(formatDaysLeft(null)).toBe('');
  });
});

describe('isCardOpen', () => {
  it('reads the column kind, and assumes open when the column is gone', () => {
    expect(isCardOpen({ column_id: 'todo' }, columns)).toBe(true);
    expect(isCardOpen({ column_id: 'done' }, columns)).toBe(false);
    expect(isCardOpen({ column_id: 'lost' }, columns)).toBe(false);
    expect(isCardOpen({ column_id: 'missing' }, columns)).toBe(true);
  });
});
