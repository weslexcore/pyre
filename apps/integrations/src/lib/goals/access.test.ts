import { describe, expect, it } from 'vitest';
import { completionPreview, goalStatusPatch } from './access';

const NOW = '2026-09-21T12:00:00Z';
const goal = (over: Record<string, unknown> = {}) => ({
  status: 'planned' as const,
  started_at: null,
  completed_at: null,
  completed_by: null,
  ...over,
});

describe('goalStatusPatch', () => {
  it('stamps started_at the first time a goal goes active', () => {
    const patch = goalStatusPatch(goal(), 'active', 'wes@pyresauna.com', NOW);
    expect(patch).toEqual({
      status: 'active',
      started_at: NOW,
      completed_at: null,
      completed_by: null,
    });
  });

  it('never overwrites started_at', () => {
    const earlier = '2026-01-04T09:00:00Z';
    const running = goal({ status: 'active', started_at: earlier });
    expect(goalStatusPatch(running, 'planned', 'wes@pyresauna.com', NOW).started_at).toBe(earlier);
    expect(goalStatusPatch(running, 'active', 'wes@pyresauna.com', NOW).started_at).toBe(earlier);
    expect(goalStatusPatch(running, 'completed', 'wes@pyresauna.com', NOW).started_at).toBe(
      earlier
    );
  });

  it('attributes a completion', () => {
    const patch = goalStatusPatch(
      goal({ status: 'active' }),
      'completed',
      'julien@pyresauna.com',
      NOW
    );
    expect(patch.completed_at).toBe(NOW);
    expect(patch.completed_by).toBe('julien@pyresauna.com');
  });

  it('keeps the original completion when a completed goal is re-saved', () => {
    const done = goal({
      status: 'completed',
      completed_at: '2026-03-01T10:00:00Z',
      completed_by: 'wes@pyresauna.com',
    });
    const patch = goalStatusPatch(done, 'completed', 'julien@pyresauna.com', NOW);
    expect(patch.completed_at).toBe('2026-03-01T10:00:00Z');
    expect(patch.completed_by).toBe('wes@pyresauna.com');
  });

  it('clears the completion when a goal is reopened', () => {
    const done = goal({
      status: 'completed',
      completed_at: '2026-03-01T10:00:00Z',
      completed_by: 'wes@pyresauna.com',
    });
    const patch = goalStatusPatch(done, 'active', 'wes@pyresauna.com', NOW);
    expect(patch.completed_at).toBeNull();
    expect(patch.completed_by).toBeNull();
  });

  it('leaves a dropped goal without a completion stamp', () => {
    const patch = goalStatusPatch(goal({ status: 'active' }), 'dropped', 'wes@pyresauna.com', NOW);
    expect(patch).toMatchObject({ status: 'dropped', completed_at: null, completed_by: null });
  });
});

describe('completionPreview', () => {
  const columns = new Map([
    ['open', { kind: 'open' as const }],
    ['done', { kind: 'done' as const }],
    ['lost', { kind: 'dropped' as const }],
  ]);
  const kpi = (current: number | null) => ({
    direction: 'at_least' as const,
    start_value: 0,
    target_value: 4,
    current_value: current,
  });

  it('reports both numbers without blocking anything', () => {
    const preview = completionPreview(
      [kpi(4), kpi(1)],
      [{ column_id: 'open' }, { column_id: 'open' }, { column_id: 'done' }],
      columns
    );
    expect(preview).toEqual({ kpisMet: 1, kpisTotal: 2, openCards: 2, clean: false });
  });

  it('counts dropped cards as finished, not as open work', () => {
    const preview = completionPreview([], [{ column_id: 'lost' }, { column_id: 'done' }], columns);
    expect(preview).toMatchObject({ openCards: 0, clean: true });
  });

  it('is clean when every KPI is met and nothing is open', () => {
    expect(completionPreview([kpi(4)], [{ column_id: 'done' }], columns).clean).toBe(true);
    expect(completionPreview([kpi(3)], [{ column_id: 'done' }], columns).clean).toBe(false);
  });

  it('treats a card whose column vanished as open', () => {
    expect(completionPreview([], [{ column_id: 'gone' }], columns).openCards).toBe(1);
  });
});
