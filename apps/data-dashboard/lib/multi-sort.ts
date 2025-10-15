import type { SessionRecord } from "@/lib/data";

export type SortDirection = "asc" | "desc";

export type SortColumn =
  | "source"
  | "date"
  | "time"
  | "location"
  | "sessionName"
  | "sessionType"
  | "instructor"
  | "room"
  | "booked"
  | "totalSpots"
  | "spotsAvailable"
  | "fillRate"
  | "cumulativeBookings";

export type SortPriority = {
  column: SortColumn;
  direction: SortDirection;
};

export type MultiSortState = SortPriority[];

export type SortDefinition = {
  column: SortColumn;
  label: string;
  getValue: (record: SessionRecord) => string | number;
  defaultDirection: SortDirection;
  type: "string" | "number";
  tieBreaker?: SortColumn;
};

const SORT_DEFINITIONS: Record<SortColumn, SortDefinition> = {
  source: {
    column: "source",
    label: "Source",
    getValue: (record) => record.source ?? "",
    defaultDirection: "asc",
    type: "string",
    tieBreaker: "sessionName",
  },
  date: {
    column: "date",
    label: "Date",
    getValue: (record) => Date.parse(record.timestamp),
    defaultDirection: "desc",
    type: "number",
    tieBreaker: "sessionName",
  },
  time: {
    column: "time",
    label: "Time",
    getValue: (record) => Date.parse(record.timestamp),
    defaultDirection: "desc",
    type: "number",
    tieBreaker: "sessionName",
  },
  location: {
    column: "location",
    label: "Location",
    getValue: (record) => record.location ?? "",
    defaultDirection: "asc",
    type: "string",
    tieBreaker: "sessionName",
  },
  sessionName: {
    column: "sessionName",
    label: "Session",
    getValue: (record) => record.sessionName ?? "",
    defaultDirection: "asc",
    type: "string",
  },
  sessionType: {
    column: "sessionType",
    label: "Type",
    getValue: (record) => record.sessionType ?? "",
    defaultDirection: "asc",
    type: "string",
    tieBreaker: "sessionName",
  },
  instructor: {
    column: "instructor",
    label: "Instructor",
    getValue: (record) => record.instructor ?? "",
    defaultDirection: "asc",
    type: "string",
    tieBreaker: "sessionName",
  },
  room: {
    column: "room",
    label: "Room",
    getValue: (record) => record.room ?? "",
    defaultDirection: "asc",
    type: "string",
    tieBreaker: "sessionName",
  },
  booked: {
    column: "booked",
    label: "Booked",
    getValue: (record) => record.booked ?? 0,
    defaultDirection: "desc",
    type: "number",
    tieBreaker: "date",
  },
  totalSpots: {
    column: "totalSpots",
    label: "Spots",
    getValue: (record) => record.totalSpots ?? 0,
    defaultDirection: "desc",
    type: "number",
    tieBreaker: "date",
  },
  spotsAvailable: {
    column: "spotsAvailable",
    label: "Avail.",
    getValue: (record) => record.spotsAvailable ?? 0,
    defaultDirection: "desc",
    type: "number",
    tieBreaker: "date",
  },
  fillRate: {
    column: "fillRate",
    label: "Fill rate",
    getValue: (record) => record.fillRate ?? 0,
    defaultDirection: "desc",
    type: "number",
    tieBreaker: "date",
  },
  cumulativeBookings: {
    column: "cumulativeBookings",
    label: "Cumulative",
    getValue: (record) => record.cumulativeBookings ?? 0,
    defaultDirection: "desc",
    type: "number",
    tieBreaker: "date",
  },
};

export { SORT_DEFINITIONS };

export const DEFAULT_SORT_COLUMN: SortColumn = "date";

export function createDefaultSort(): SortPriority {
  const definition = SORT_DEFINITIONS[DEFAULT_SORT_COLUMN];
  return {
    column: DEFAULT_SORT_COLUMN,
    direction: definition?.defaultDirection ?? "desc",
  };
}

export function createDefaultMultiSortState(): MultiSortState {
  return [createDefaultSort()];
}

export function isSortColumn(value: string): value is SortColumn {
  return value in SORT_DEFINITIONS;
}

export const SORTABLE_COLUMNS: SortColumn[] = Object.keys(
  SORT_DEFINITIONS,
) as SortColumn[];

function compareColumnBase(
  a: SessionRecord,
  b: SessionRecord,
  column: SortColumn,
  visited: Set<SortColumn> = new Set(),
): number {
  const definition =
    SORT_DEFINITIONS[column] ?? SORT_DEFINITIONS[DEFAULT_SORT_COLUMN];
  const rawA = definition.getValue(a);
  const rawB = definition.getValue(b);

  let comparison: number;
  if (definition.type === "number") {
    const valueA = typeof rawA === "number" ? rawA : Number(rawA) || 0;
    const valueB = typeof rawB === "number" ? rawB : Number(rawB) || 0;
    comparison = valueA - valueB;
  } else {
    const valueA = String(rawA ?? "").toLocaleLowerCase();
    const valueB = String(rawB ?? "").toLocaleLowerCase();
    comparison = valueA.localeCompare(valueB);
  }

  if (comparison !== 0) {
    return comparison;
  }

  const { tieBreaker } = definition;
  if (!tieBreaker || tieBreaker === column) {
    return 0;
  }

  if (visited.has(column)) {
    return 0;
  }

  visited.add(column);

  if (!isSortColumn(tieBreaker) || visited.has(tieBreaker)) {
    return 0;
  }

  return compareColumnBase(a, b, tieBreaker, visited);
}

function compareWithPriorities(
  a: SessionRecord,
  b: SessionRecord,
  priorities: readonly SortPriority[],
): number {
  for (const priority of priorities) {
    const comparison = compareColumnBase(a, b, priority.column);
    if (comparison !== 0) {
      const multiplier = priority.direction === "asc" ? 1 : -1;
      return comparison * multiplier;
    }
  }
  return 0;
}

export function sanitizeSortStack(
  sortStack: MultiSortState,
): SortPriority[] {
  const seen = new Set<SortColumn>();
  const sanitized: SortPriority[] = [];

  for (const entry of sortStack) {
    if (!entry) {
      continue;
    }
    const column = entry.column;
    if (!column || !isSortColumn(column) || seen.has(column)) {
      continue;
    }
    const definition =
      SORT_DEFINITIONS[column] ?? SORT_DEFINITIONS[DEFAULT_SORT_COLUMN];
    const direction =
      entry.direction === "asc" || entry.direction === "desc"
        ? entry.direction
        : definition.defaultDirection;
    sanitized.push({
      column,
      direction,
    });
    seen.add(column);
  }

  return sanitized;
}

export function normalizeSortStack(
  sortStack: MultiSortState,
): SortPriority[] {
  const sanitized = sanitizeSortStack(sortStack);
  const seen = new Set<SortColumn>(sanitized.map((entry) => entry.column));

  if (!seen.has(DEFAULT_SORT_COLUMN)) {
    const fallback = createDefaultSort();
    sanitized.push(fallback);
    seen.add(DEFAULT_SORT_COLUMN);
  }

  if (sanitized.length === 0) {
    sanitized.push(createDefaultSort());
  }

  return sanitized;
}

export function sortStacksEqual(
  a: MultiSortState,
  b: MultiSortState,
): boolean {
  if (a === b) {
    return true;
  }

  const sanitizedA = sanitizeSortStack(a);
  const sanitizedB = sanitizeSortStack(b);

  if (sanitizedA.length !== sanitizedB.length) {
    return false;
  }

  for (let index = 0; index < sanitizedA.length; index += 1) {
    const entryA = sanitizedA[index];
    const entryB = sanitizedB[index];
    if (
      entryA.column !== entryB.column ||
      entryA.direction !== entryB.direction
    ) {
      return false;
    }
  }

  return true;
}

export function resolvePrimarySort(sortStack: MultiSortState): SortPriority {
  const [first] = normalizeSortStack(sortStack);
  return first ?? createDefaultSort();
}

export function buildMultiSortComparator(
  sortStack: MultiSortState,
): (a: SessionRecord, b: SessionRecord) => number {
  const priorities = normalizeSortStack(sortStack);
  return (a, b) => compareWithPriorities(a, b, priorities);
}

export function sortRecordsByState(
  records: SessionRecord[],
  sortStack: MultiSortState,
): SessionRecord[] {
  const comparator = buildMultiSortComparator(sortStack);
  return [...records].sort(comparator);
}
