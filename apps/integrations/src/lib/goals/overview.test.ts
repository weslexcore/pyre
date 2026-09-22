import { describe, expect, it } from 'vitest';
import type { BoardRow, GoalKpiRow, GoalRow } from '@/lib/db';
import { buildGoalRows, filterRows, groupByStatus, NO_OWNER, summarize } from './overview';

const TODAY = '2026-09-21';

function goal(id: string, over: Partial<GoalRow> = {}): GoalRow {
  return {
    id,
    parent_id: null,
    title: id,
    description_md: '',
    status: 'active',
    owner_email: null,
    area: null,
    started_at: '2026-09-01T00:00:00Z',
    target_date: null,
    sort_order: 0,
    completed_at: null,
    completed_by: null,
    completion_note: null,
    created_by: null,
    updated_by: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}

function board(id: string, goal_id: string | null, archived = false): BoardRow {
  return {
    id,
    slug: id,
    name: id,
    description: '',
    card_noun: 'task',
    include_in_all_tasks: true,
    goal_id,
    section_id: null,
    sort_order: 0,
    archived,
    created_by: null,
    updated_by: null,
    created_at: '',
    updated_at: '',
  };
}

function kpi(id: string, goal_id: string, current: number | null, target = 10): GoalKpiRow {
  return {
    id,
    goal_id,
    name: id,
    unit: null,
    direction: 'at_least',
    start_value: 0,
    target_value: target,
    current_value: current,
    source: 'manual',
    measured_at: null,
    measured_by: null,
    sort_order: 0,
    created_by: null,
    updated_by: null,
    created_at: '',
    updated_at: '',
  };
}

const columns = [
  { id: 'todo', kind: 'open' as const },
  { id: 'done', kind: 'done' as const },
];

describe('buildGoalRows', () => {
  it('pairs each goal with its board, its KPIs, and its rollup', () => {
    const rows = buildGoalRows(
      {
        goals: [goal('a'), goal('b')],
        kpis: [kpi('k1', 'a', 10), kpi('k2', 'a', 2)],
        boards: [board('board-a', 'a')],
        columns,
        cards: [
          { goal_id: 'a', column_id: 'done' },
          { goal_id: 'a', column_id: 'todo' },
          { goal_id: 'b', column_id: 'todo' },
        ],
      },
      TODAY
    );
    const a = rows.find((row) => row.goal.id === 'a');
    const b = rows.find((row) => row.goal.id === 'b');
    expect(a?.board?.slug).toBe('board-a');
    expect(a?.kpis.map((k) => k.id)).toEqual(['k1', 'k2']);
    expect(a?.rollup.tasks).toMatchObject({ total: 2, done: 1 });
    expect(a?.rollup.kpis).toMatchObject({ total: 2, met: 1 });
    expect(b?.board).toBeNull();
    expect(b?.kpis).toEqual([]);
  });

  it('prefers a live board over an archived one serving the same goal', () => {
    const rows = buildGoalRows(
      {
        goals: [goal('a')],
        kpis: [],
        boards: [board('old', 'a', true), board('new', 'a')],
        columns,
        cards: [],
      },
      TODAY
    );
    expect(rows[0].board?.slug).toBe('new');
  });

  it("counts a child goal's work toward its parent", () => {
    const rows = buildGoalRows(
      {
        goals: [goal('parent'), goal('child', { parent_id: 'parent' })],
        kpis: [],
        boards: [],
        columns,
        cards: [{ goal_id: 'child', column_id: 'done' }],
      },
      TODAY
    );
    const parent = rows.find((row) => row.goal.id === 'parent');
    expect(parent?.rollup.tasks.done).toBe(1);
    expect(parent?.rollup.childCount).toBe(1);
  });
});

describe('groupByStatus', () => {
  it('puts active before planned, orders by pace then date, and drops empty statuses', () => {
    const rows = buildGoalRows(
      {
        goals: [
          goal('undated'),
          goal('overdue', { target_date: '2026-09-01' }),
          goal('soon', { target_date: '2026-12-01', started_at: '2026-09-20T00:00:00Z' }),
          goal('later', { target_date: '2026-12-31', started_at: '2026-09-20T00:00:00Z' }),
          goal('planned', { status: 'planned' }),
        ],
        kpis: [],
        boards: [],
        columns,
        cards: [],
      },
      TODAY
    );
    const groups = groupByStatus(rows);
    expect(groups.map((group) => group.status)).toEqual(['active', 'planned']);
    const active = groups.find((group) => group.status === 'active');
    // overdue first; the two just-started goals are on track and read by
    // date; the undated goal (no pace) last.
    expect(active?.rows.map((row) => row.goal.id)).toEqual(['overdue', 'soon', 'later', 'undated']);
  });

  it('lists the closed statuses after the open ones, newest goal first', () => {
    const rows = buildGoalRows(
      {
        goals: [
          goal('first', { status: 'completed', completed_at: '2026-08-01T00:00:00Z' }),
          goal('latest', { status: 'completed', completed_at: '2026-09-10T00:00:00Z' }),
          goal('gone', { status: 'dropped' }),
          goal('idea', { status: 'planned' }),
        ],
        kpis: [],
        boards: [],
        columns,
        cards: [],
      },
      TODAY
    );
    const groups = groupByStatus(rows);
    expect(groups.map((group) => group.status)).toEqual(['planned', 'completed', 'dropped']);
    expect(groups[1].rows.map((row) => row.goal.id)).toEqual(['latest', 'first']);
  });
});

describe('summarize', () => {
  it('counts statuses, overdue and behind goals, and KPIs on open goals only', () => {
    const rows = buildGoalRows(
      {
        goals: [
          goal('late', { target_date: '2026-09-01' }),
          goal('fine'),
          goal('done', { status: 'completed', completed_at: '2026-09-10T00:00:00Z' }),
          goal('idea', { status: 'planned' }),
        ],
        kpis: [kpi('k1', 'late', 10), kpi('k2', 'fine', 0), kpi('k3', 'done', 10)],
        boards: [],
        columns,
        cards: [],
      },
      TODAY
    );
    expect(summarize(rows)).toEqual({
      byStatus: { planned: 1, active: 2, completed: 1, dropped: 0 },
      overdue: 1,
      behind: 0,
      kpisMet: 1,
      kpisTotal: 2,
    });
  });
});

describe('filterRows', () => {
  const rows = buildGoalRows(
    {
      goals: [
        goal('a', { owner_email: 'a@x.com', area: 'Tech' }),
        goal('b', { owner_email: null, area: 'Events' }),
      ],
      kpis: [],
      boards: [],
      columns,
      cards: [],
    },
    TODAY
  );

  it('filters by owner, including the goals nobody drives', () => {
    expect(filterRows(rows, { owner: 'a@x.com', area: 'all' }).map((r) => r.goal.id)).toEqual([
      'a',
    ]);
    expect(filterRows(rows, { owner: NO_OWNER, area: 'all' }).map((r) => r.goal.id)).toEqual(['b']);
  });

  it('filters by area and passes everything through on all', () => {
    expect(filterRows(rows, { owner: 'all', area: 'Events' }).map((r) => r.goal.id)).toEqual(['b']);
    expect(filterRows(rows, { owner: 'all', area: 'all' })).toHaveLength(2);
  });
});
