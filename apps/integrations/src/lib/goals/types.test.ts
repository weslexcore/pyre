import { describe, expect, it } from 'vitest';
import {
  AREAS,
  GOAL_STATUSES,
  GOAL_STATUS_HINTS,
  GOAL_STATUS_LABELS,
  GROUP_BY,
  KPI_DIRECTIONS,
  KPI_DIRECTION_HINTS,
  KPI_DIRECTION_LABELS,
  isArea,
  isClosedStatus,
  isGoalStatus,
  isGroupBy,
  isKpiDirection,
} from './types';

describe('guards', () => {
  it('accepts exactly the listed values', () => {
    for (const status of GOAL_STATUSES) expect(isGoalStatus(status)).toBe(true);
    expect(isGoalStatus('paused')).toBe(false);
    expect(isGoalStatus(undefined)).toBe(false);

    for (const direction of KPI_DIRECTIONS) expect(isKpiDirection(direction)).toBe(true);
    expect(isKpiDirection('more')).toBe(false);

    for (const area of AREAS) expect(isArea(area)).toBe(true);
    expect(isArea('operations')).toBe(false); // the labels are capitalised

    for (const group of GROUP_BY) expect(isGroupBy(group)).toBe(true);
    expect(isGroupBy('area')).toBe(false);
  });
});

describe('isClosedStatus', () => {
  it('counts dropped as finished too', () => {
    expect(isClosedStatus('completed')).toBe(true);
    expect(isClosedStatus('dropped')).toBe(true);
    expect(isClosedStatus('active')).toBe(false);
    expect(isClosedStatus('planned')).toBe(false);
  });
});

describe('label records', () => {
  it('covers every status and direction', () => {
    for (const status of GOAL_STATUSES) {
      expect(GOAL_STATUS_LABELS[status]).toBeTruthy();
      expect(GOAL_STATUS_HINTS[status]).toBeTruthy();
    }
    for (const direction of KPI_DIRECTIONS) {
      expect(KPI_DIRECTION_LABELS[direction]).toBeTruthy();
      expect(KPI_DIRECTION_HINTS[direction]).toBeTruthy();
    }
  });

  it('keeps the nine Trello labels', () => {
    expect(AREAS).toHaveLength(9);
    expect(AREAS).toContain('Operations');
    expect(AREAS).toContain('Partnerships');
  });
});
