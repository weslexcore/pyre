// Client-safe vocabulary for goals: the statuses, the KPI directions, the
// areas carried over from the Trello labels, and the limits the forms and
// the routes agree on. Pure and import-free (bar types), because adminTools
// reads the hrefs from here and every island reads the rest.

/**
 * The href the old Goals page was granted under. The page is gone — goals
 * live on their boards now — but a staff row still holding this grant opens
 * the merged tool (adminTools LEGACY_PAGE_GRANTS) and /admin/goals/* redirects.
 */
export const GOALS_HREF = '/admin/goals';

/** The cross-board page: everything in flight, wherever it is filed. */
export const ALL_TASKS_HREF = '/admin/boards/tasks';

/**
 * The other cross-board page: every goal, where it stands, and the board
 * that serves it. Lives under /admin/boards so the tool's grant covers it;
 * /admin/boards/goals is the seeded Tasks board, hence the longer name.
 */
export const ALL_GOALS_HREF = '/admin/boards/all-goals';

export const GOAL_STATUSES = ['planned', 'active', 'completed', 'dropped'] as const;
export type GoalStatusValue = (typeof GOAL_STATUSES)[number];

export const GOAL_STATUS_LABELS: Record<GoalStatusValue, string> = {
  planned: 'Planned',
  active: 'Active',
  completed: 'Completed',
  dropped: 'Dropped',
};

export const GOAL_STATUS_HINTS: Record<GoalStatusValue, string> = {
  planned: 'Written down, not started. Where an idea waits.',
  active: 'Being worked on now.',
  completed: 'Met — a decision somebody made, not a counter that hit zero.',
  dropped: 'Deliberately abandoned. Kept so the reasoning survives.',
};

export function isGoalStatus(value: unknown): value is GoalStatusValue {
  return typeof value === 'string' && (GOAL_STATUSES as readonly string[]).includes(value);
}

/** Statuses a goal is finished in, well or otherwise. */
export function isClosedStatus(status: GoalStatusValue): boolean {
  return status === 'completed' || status === 'dropped';
}

export const KPI_DIRECTIONS = ['at_least', 'at_most'] as const;
export type KpiDirectionValue = (typeof KPI_DIRECTIONS)[number];

export const KPI_DIRECTION_LABELS: Record<KpiDirectionValue, string> = {
  at_least: 'At least',
  at_most: 'At most',
};

export const KPI_DIRECTION_HINTS: Record<KpiDirectionValue, string> = {
  at_least: 'Higher is better — four consecutive weeks, ten shifts, 80%.',
  at_most: 'Lower is better — two callouts a month, one hour of founder time.',
};

export function isKpiDirection(value: unknown): value is KpiDirectionValue {
  return typeof value === 'string' && (KPI_DIRECTIONS as readonly string[]).includes(value);
}

// The nine labels the Trello board used, kept verbatim so the founders can
// file a goal or a task where they always have. Free text in the database, so
// this list can grow without a migration.
export const AREAS = [
  'Operations',
  'Marketing',
  'Experience',
  'Events',
  'Tech',
  'Partnerships',
  'Merch',
  'Purchase',
  'Employees',
] as const;
export type Area = (typeof AREAS)[number];

export function isArea(value: unknown): value is Area {
  return typeof value === 'string' && (AREAS as readonly string[]).includes(value);
}

/**
 * Limits shared by the forms (maxLength) and the routes (validation),
 * mirroring the check constraints in the migration.
 */
export const GOAL_LIMITS = {
  title: 200,
  description: 20000,
  completionNote: 2000,
  kpiName: 120,
  kpiUnit: 20,
  area: 40,
  /** numeric columns take more, but a KPI past this is a typo. */
  kpiValue: 1_000_000_000,
} as const;

/**
 * How All Tasks groups its open cards. A card's goal is its board's goal, so
 * grouping by goal would be grouping by board under another name.
 */
export const GROUP_BY = ['board', 'owner'] as const;
export type GroupBy = (typeof GROUP_BY)[number];

export function isGroupBy(value: unknown): value is GroupBy {
  return typeof value === 'string' && (GROUP_BY as readonly string[]).includes(value);
}
