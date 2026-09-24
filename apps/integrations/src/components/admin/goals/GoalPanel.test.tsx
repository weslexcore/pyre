import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BoardRow, GoalKpiRow, GoalRow } from '@/lib/db';
import { buildGoalRows } from '@/lib/goals/overview';
import type { GoalsOverviewData } from '@/lib/goals/store';
import { GoalPanel } from './GoalPanel';

const goal = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Staff run the space',
  description_md: 'Nobody calls a founder on a Saturday.',
  status: 'active',
  owner_email: null,
  area: null,
  target_date: null,
  parent_id: null,
  sort_order: 0,
  started_at: '2026-09-01T00:00:00Z',
  completed_at: null,
  completed_by: null,
  completion_note: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
} as GoalRow;

const kpi = {
  id: '22222222-2222-4222-8222-222222222222',
  goal_id: goal.id,
  name: 'Unassisted shifts',
  unit: null,
  direction: 'at_least',
  start_value: 0,
  target_value: 10,
  current_value: 4,
  measured_at: null,
  measured_by: null,
  sort_order: 0,
} as GoalKpiRow;

function board(slug: string, extra: Partial<BoardRow> = {}): BoardRow {
  return {
    id: `board-${slug}`,
    slug,
    name: slug[0].toUpperCase() + slug.slice(1),
    card_noun: 'task',
    goal_id: null,
    archived: false,
    ...extra,
  } as BoardRow;
}

function render(boards: BoardRow[]) {
  const data: GoalsOverviewData = {
    goals: [goal],
    kpis: [kpi],
    boards,
    columns: [],
    owners: [],
    cards: [],
    people: {},
    today: '2026-09-24',
  };
  const [row] = buildGoalRows(data, data.today);
  return renderToStaticMarkup(
    <GoalPanel
      row={row}
      data={data}
      nowIso="2026-09-24T12:00:00Z"
      busy={false}
      mutate={async () => undefined}
    />
  );
}

describe('GoalPanel', () => {
  it('manages a goal no board serves, offering only open boards without a goal', () => {
    const html = render([
      board('rentals'),
      board('events', { goal_id: 'someone-else' }),
      board('old', { archived: true }),
    ]);
    expect(html).toContain('Edit');
    expect(html).toContain('Mark completed');
    expect(html).toContain('Delete');
    expect(html).toContain('Add a KPI');
    expect(html).toContain('Unassisted shifts');
    expect(html).toContain('Nobody calls a founder on a Saturday.');
    expect(html).toContain('<option value="rentals">Rentals</option>');
    expect(html).not.toContain('value="events"');
    expect(html).not.toContain('value="old"');
    expect(html).toContain('Attach');
    expect(html).not.toContain('Detach');
  });

  it('says so when every open board already serves a goal', () => {
    const html = render([board('events', { goal_id: 'someone-else' })]);
    expect(html).toContain('Every open board already serves a goal');
    expect(html).not.toContain('Attach');
  });

  it('links the board that serves it and offers to detach', () => {
    const html = render([board('rentals', { goal_id: goal.id })]);
    expect(html).toContain('href="/admin/boards/rentals"');
    expect(html).toContain('Detach');
    expect(html).not.toContain('Attach');
  });
});
