import { describe, expect, it } from 'vitest';
import { formatKpiValue, goalKpiSummary, kpiFreshness, kpiProgress } from './kpis';
import type { KpiInput } from './kpis';

const kpi = (over: Partial<KpiInput> = {}): KpiInput => ({
  direction: 'at_least',
  start_value: 0,
  target_value: 4,
  current_value: null,
  ...over,
});

describe('kpiProgress', () => {
  it('scales start -> target, not zero -> target', () => {
    // Three of the four weeks were already behind us when the goal was
    // written: one more week is half the remaining distance, not 75% done.
    const progress = kpiProgress(kpi({ start_value: 2, target_value: 4, current_value: 3 }));
    expect(progress.pct).toBe(50);
    expect(progress.met).toBe(false);
  });

  it('meets an at_least KPI once current reaches target', () => {
    expect(kpiProgress(kpi({ current_value: 4 })).met).toBe(true);
    expect(kpiProgress(kpi({ current_value: 5 })).met).toBe(true);
    expect(kpiProgress(kpi({ current_value: 5 })).pct).toBe(100);
    expect(kpiProgress(kpi({ current_value: 3 })).met).toBe(false);
  });

  it('inverts for at_most: lower is better', () => {
    const falling = kpi({ direction: 'at_most', start_value: 10, target_value: 2 });
    expect(kpiProgress({ ...falling, current_value: 10 }).pct).toBe(0);
    expect(kpiProgress({ ...falling, current_value: 6 }).pct).toBe(50);
    expect(kpiProgress({ ...falling, current_value: 2 }).met).toBe(true);
    expect(kpiProgress({ ...falling, current_value: 1 }).met).toBe(true);
    expect(kpiProgress({ ...falling, current_value: 3 }).met).toBe(false);
  });

  it('reads an unmeasured KPI as 0 and unmet, not as zero progress toward at_most', () => {
    const unmeasured = kpiProgress(kpi({ current_value: null }));
    expect(unmeasured).toMatchObject({ pct: 0, met: false, measured: false });
    // at_most with a current of 0 really is met — the difference matters.
    expect(kpiProgress(kpi({ direction: 'at_most', target_value: 2, current_value: 0 })).met).toBe(
      true
    );
  });

  it('falls back to all-or-nothing when there is no distance to measure', () => {
    // start already past target (the two typed the wrong way round)
    const inverted = kpi({ start_value: 6, target_value: 4, current_value: 5 });
    expect(kpiProgress(inverted).pct).toBe(100);
    expect(kpiProgress({ ...inverted, current_value: 3 }).pct).toBe(0);

    // at_most with no baseline: no sensible default, so it is met or it isn't.
    const noStart = kpi({ direction: 'at_most', start_value: null, target_value: 2 });
    expect(kpiProgress({ ...noStart, current_value: 1 }).pct).toBe(100);
    expect(kpiProgress({ ...noStart, current_value: 9 }).pct).toBe(0);
  });

  it('treats a missing start on an at_least KPI as zero', () => {
    expect(kpiProgress(kpi({ start_value: null, current_value: 1 })).pct).toBe(25);
  });

  it('clamps past the target', () => {
    expect(kpiProgress(kpi({ current_value: 40 })).pct).toBe(100);
    expect(kpiProgress(kpi({ current_value: -5 })).pct).toBe(0);
  });
});

describe('kpiFreshness', () => {
  const now = '2026-09-21T12:00:00Z';

  it('counts whole days since the last measurement', () => {
    expect(kpiFreshness({ measured_at: '2026-09-21T09:00:00Z' }, now)).toBe(0);
    expect(kpiFreshness({ measured_at: '2026-09-09T12:00:00Z' }, now)).toBe(12);
  });

  it('is null for a KPI nobody has measured', () => {
    expect(kpiFreshness({ measured_at: null }, now)).toBeNull();
  });
});

describe('goalKpiSummary', () => {
  it('counts met and averages progress', () => {
    const summary = goalKpiSummary([
      kpi({ current_value: 4 }), // met, 100
      kpi({ current_value: 1 }), // 25
    ]);
    expect(summary).toMatchObject({ total: 2, met: 1, pct: 63, allMet: false, unmeasured: 0 });
  });

  it('reports an empty list as nothing rather than as met', () => {
    expect(goalKpiSummary([])).toMatchObject({ total: 0, met: 0, allMet: false });
  });

  it('counts the KPIs nobody has put a number on', () => {
    expect(goalKpiSummary([kpi(), kpi({ current_value: 4 })]).unmeasured).toBe(1);
  });
});

describe('formatKpiValue', () => {
  it('puts the unit where it belongs', () => {
    expect(formatKpiValue(4, 'weeks')).toBe('4 weeks');
    expect(formatKpiValue(80, '%')).toBe('80%');
    expect(formatKpiValue(1200, '$')).toBe('$1200');
    expect(formatKpiValue(3, null)).toBe('3');
    expect(formatKpiValue(null, 'weeks')).toBe('—');
  });
});
