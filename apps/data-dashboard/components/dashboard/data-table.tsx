"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { SessionRecord } from "@/lib/data";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { clearSortState, loadSortState, saveSortState } from "@/lib/session-sort";
import {
  buildMultiSortComparator,
  createDefaultMultiSortState,
  MultiSortState,
  normalizeSortStack,
  resolvePrimarySort,
  SORT_DEFINITIONS,
  SortColumn,
  SortDirection,
  SortPriority,
  sanitizeSortStack,
  sortStacksEqual,
} from "@/lib/multi-sort";
import { SortPanel } from "./sort-panel";
import { cn } from "@/lib/utils";

function createDatasetSignature(records: SessionRecord[]): string {
  if (records.length === 0) {
    return "empty";
  }
  let minTimestamp = records[0].timestamp;
  let maxTimestamp = records[0].timestamp;
  const sources = new Set<string>();

  for (const record of records) {
    sources.add(record.source ?? "");
    if (record.timestamp < minTimestamp) {
      minTimestamp = record.timestamp;
    }
    if (record.timestamp > maxTimestamp) {
      maxTimestamp = record.timestamp;
    }
  }

  const sourcesKey = Array.from(sources).sort().join("|");
  return [records.length, minTimestamp, maxTimestamp, sourcesKey].join(":");
}

type SortableHeaderProps = {
  children: ReactNode;
  column: SortColumn;
  align?: "left" | "right";
  isActive: boolean;
  direction?: SortDirection;
  priority?: number | null;
  priorityDirection?: SortDirection;
  priorityLabel?: string | null;
  onSort: (column: SortColumn) => void;
};

function SortableHeader({
  children,
  column,
  align = "left",
  isActive,
  direction,
  priority,
  priorityDirection,
  onSort,
}: SortableHeaderProps) {
  const Icon =
    direction === "asc"
      ? ArrowUp
      : direction === "desc"
        ? ArrowDown
        : ArrowUpDown;
  const labelText =
    typeof children === "string" ? children.trim() : "column";
  const statusSegments: string[] = [];
  if (priority) {
    statusSegments.push(`priority ${priority}`);
  }
  if (isActive) {
    statusSegments.push(direction === "asc" ? "ascending" : "descending");
  }
  const statusText =
    statusSegments.length > 0 ? statusSegments.join(", ") : "not sorted";

  return (
    <TableHead
      aria-sort={
        isActive
          ? direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
      className={cn(
        align === "right" && "text-right",
        isActive && "bg-muted/40",
      )}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "group flex w-full items-center gap-1 rounded-sm px-1 py-1 text-left font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          align === "right" ? "justify-end text-right" : "justify-start",
          isActive
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
        aria-pressed={isActive}
        aria-label={`Sort by ${labelText} (${statusText})`}
        title={`Sort by ${labelText} (${statusText})`}
      >
        <span className="flex items-center gap-1 truncate">
          {priority ? (
            <Badge
              variant={isActive ? "default" : "secondary"}
              className={cn(
                "h-5 w-5 shrink-0 justify-center rounded-full p-0 text-xs font-medium",
                !isActive && "bg-muted text-muted-foreground",
              )}
              aria-hidden="true"
            >
              {priority}
            </Badge>
          ) : null}
          <span className="truncate">{children}</span>
        </span>
        <span className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground transition-colors group-hover:text-foreground">
          <Icon className="h-3.5 w-3.5 transition-transform" />
        </span>
      </button>
      {priority && priorityDirection ? (
        <span className="mt-1 block text-xs font-medium text-muted-foreground sm:hidden">
          Priority {priority} · {priorityDirection === "asc" ? "Asc" : "Desc"}
        </span>
      ) : null}
    </TableHead>
  );
}

type FilterState = {
  global: string;
  source: string;
  location: string;
  sessionType: string;
  dayOfWeek: string;
  date: string;
  time: string;
  duration: string;
  sessionName: string;
  instructor: string;
  room: string;
  bookedMin: string;
  totalSpotsMin: string;
  spotsAvailableMin: string;
  cumulativeBookingsMin: string;
};

const DEFAULT_FILTERS: FilterState = {
  global: "",
  source: "all",
  location: "all",
  sessionType: "all",
  dayOfWeek: "all",
  date: "",
  time: "",
  duration: "",
  sessionName: "",
  instructor: "",
  room: "",
  bookedMin: "",
  totalSpotsMin: "",
  spotsAvailableMin: "",
  cumulativeBookingsMin: "",
};

const PAGE_SIZE_OPTIONS = [25, 50, 100, 300, 500, 1000];

export function DataTable({ data }: { data: SessionRecord[] }) {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const [page, setPage] = useState(0);
  const [sortStack, setSortStack] = useState<MultiSortState>(() =>
    createDefaultMultiSortState(),
  );
  const [isSortPanelOpen, setIsSortPanelOpen] = useState(false);
  const datasetSignature = useMemo(
    () => createDatasetSignature(data),
    [data],
  );
  const sortableColumns = useMemo(
    () => Object.values(SORT_DEFINITIONS),
    [],
  );
  const numericFilters = useMemo(
    () => ({
      booked: Number(filters.bookedMin) || undefined,
      totalSpots: Number(filters.totalSpotsMin) || undefined,
      spotsAvailable: Number(filters.spotsAvailableMin) || undefined,
      cumulativeBookings: Number(filters.cumulativeBookingsMin) || undefined,
    }),
    [filters],
  );

  const uniqueSources = useMemo(
    () =>
      Array.from(new Set(data.map((record) => record.source)))
        .filter(Boolean)
        .sort(),
    [data],
  );
  const uniqueLocations = useMemo(
    () =>
      Array.from(new Set(data.map((record) => record.location)))
        .filter(Boolean)
        .sort(),
    [data],
  );
  const uniqueTypes = useMemo(
    () =>
      Array.from(new Set(data.map((record) => record.sessionType)))
        .filter(Boolean)
        .sort(),
    [data],
  );
  const uniqueDays = useMemo(() => {
    const order = [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ];
    const available = new Set(
      data.map((record) => record.dayOfWeek).filter(Boolean),
    );
    return order.filter((day) => available.has(day));
  }, [data]);

  const filteredData = useMemo(() => {
    const globalNeedle = filters.global.trim().toLowerCase();
    return data.filter((record) => {
      if (
        globalNeedle &&
        ![
          record.source,
          record.location,
          record.sessionName,
          record.instructor,
          record.room,
          record.sessionType,
          record.date,
          record.time,
          record.duration,
        ]
          .join(" ")
          .toLowerCase()
          .includes(globalNeedle)
      ) {
        return false;
      }

      if (filters.source !== "all" && record.source !== filters.source) {
        return false;
      }
      if (filters.location !== "all" && record.location !== filters.location) {
        return false;
      }
      if (
        filters.sessionType !== "all" &&
        record.sessionType !== filters.sessionType
      ) {
        return false;
      }
      if (filters.dayOfWeek !== "all" && record.dayOfWeek !== filters.dayOfWeek) {
        return false;
      }
      if (
        filters.date &&
        !record.date.toLowerCase().includes(filters.date.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.time &&
        !record.time.toLowerCase().includes(filters.time.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.duration &&
        !record.duration.toLowerCase().includes(filters.duration.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.sessionName &&
        !record.sessionName
          .toLowerCase()
          .includes(filters.sessionName.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.instructor &&
        !(record.instructor || "")
          .toLowerCase()
          .includes(filters.instructor.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.room &&
        !(record.room || "")
          .toLowerCase()
          .includes(filters.room.toLowerCase())
      ) {
        return false;
      }
      if (
        numericFilters.booked !== undefined &&
        record.booked < numericFilters.booked
      ) {
        return false;
      }
      if (
        numericFilters.totalSpots !== undefined &&
        record.totalSpots < numericFilters.totalSpots
      ) {
        return false;
      }
      if (
        numericFilters.spotsAvailable !== undefined &&
        record.spotsAvailable < numericFilters.spotsAvailable
      ) {
        return false;
      }
      if (
        numericFilters.cumulativeBookings !== undefined &&
        record.cumulativeBookings < numericFilters.cumulativeBookings
      ) {
        return false;
      }
      return true;
    });
  }, [data, filters, numericFilters]);


  const sanitizedSortStack = useMemo(
    () => sanitizeSortStack(sortStack),
    [sortStack],
  );
  const normalizedSortStack = useMemo(
    () => normalizeSortStack(sortStack),
    [sortStack],
  );

  const priorityMap = useMemo(() => {
    const map = new Map<SortColumn, { index: number; direction: SortDirection }>();
    normalizedSortStack.forEach((entry, index) => {
      map.set(entry.column, {
        index,
        direction: entry.direction,
      });
    });
    return map;
  }, [normalizedSortStack]);

  const sortedData = useMemo(() => {
    const comparator = buildMultiSortComparator(sortStack);
    return [...filteredData].sort(comparator);
  }, [filteredData, sortStack]);

  const primarySort = useMemo(
    () => resolvePrimarySort(sortStack),
    [sortStack],
  );

  const totalPages = Math.max(1, Math.ceil(sortedData.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const visibleRows = useMemo(() => {
    const start = currentPage * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, currentPage, pageSize]);

  useEffect(() => {
    const defaultStack = createDefaultMultiSortState();

    if (data.length === 0) {
      setSortStack((previous) =>
        sortStacksEqual(previous, defaultStack) ? previous : defaultStack,
      );
      clearSortState();
      return;
    }

    const storedStack = loadSortState(datasetSignature);
    if (storedStack) {
      setSortStack((previous) =>
        sortStacksEqual(previous, storedStack) ? previous : [...storedStack],
      );
      return;
    }

    setSortStack((previous) =>
      sortStacksEqual(previous, defaultStack) ? previous : defaultStack,
    );
  }, [data.length, datasetSignature]);

  useEffect(() => {
    if (data.length === 0) {
      return;
    }
    saveSortState(datasetSignature, sortStack);
  }, [data.length, datasetSignature, sortStack]);

  function updateFilter<Key extends keyof FilterState>(key: Key, value: FilterState[Key]) {
    setPage(0);
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    setSortStack(createDefaultMultiSortState());
    setPage(0);
  }

  function handleSort(column: SortColumn) {
    const definition = SORT_DEFINITIONS[column] ?? SORT_DEFINITIONS.date;
    setSortStack((previous) => {
      const sanitized = sanitizeSortStack(previous);
      const existingIndex = sanitized.findIndex(
        (entry) => entry.column === column,
      );

      if (existingIndex === 0) {
        const current = sanitized[0];
        const nextDirection = current.direction === "asc" ? "desc" : "asc";
        const next = [...sanitized];
        next[0] = {
          column,
          direction: nextDirection,
        };
        return next;
      }

      const existingDirection =
        existingIndex >= 0
          ? sanitized[existingIndex]?.direction
          : definition.defaultDirection;

      const filtered = sanitized.filter((entry) => entry.column !== column);

      return [
        {
          column,
          direction:
            existingDirection === "asc" || existingDirection === "desc"
              ? existingDirection
              : definition.defaultDirection,
        },
        ...filtered,
      ];
    });
    setPage(0);
  }

  function handleSortPanelApply(nextStack: SortPriority[]) {
    setSortStack(nextStack);
    setPage(0);
  }

  const [primaryEntry] = sortStack;
  const activeSort = primaryEntry ?? primarySort;
  const activeColumn = activeSort.column;
  const activeDirection = activeSort.direction;
  // const normalizedSortStack = useMemo(
  //   () => normalizeSortStack(sortStack),
  //   [sortStack],
  // );

  // const priorityMap = useMemo(() => {
  //   const map = new Map<SortColumn, { index: number; direction: SortDirection }>();
  //   normalizedSortStack.forEach((entry, index) => {
  //     map.set(entry.column, {
  //       index,
  //       direction: entry.direction,
  //     });
  //   });
  //   return map;
  // }, [normalizedSortStack]);

  return (
    <>
      <SortPanel
        open={isSortPanelOpen}
        onOpenChange={setIsSortPanelOpen}
        columns={sortableColumns}
        sortStack={sanitizedSortStack}
        onApply={handleSortPanelApply}
      />
      <div className="space-y-6">
        <Card>
        <CardHeader>
          <CardTitle>Session Explorer</CardTitle>
          <CardDescription>
            Filter the combined dataset by any column to focus on the rows you need.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Input
              placeholder="Search everything..."
              value={filters.global}
              onChange={(event) => updateFilter("global", event.target.value)}
            />
            <Select
              value={filters.source}
              onValueChange={(value) => updateFilter("source", value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {uniqueSources.map((source) => (
                  <SelectItem key={source} value={source}>
                    {source}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.location}
              onValueChange={(value) => updateFilter("location", value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Location" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All locations</SelectItem>
                {uniqueLocations.map((location) => (
                  <SelectItem key={location} value={location}>
                    {location}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.sessionType}
              onValueChange={(value) => updateFilter("sessionType", value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Session type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All session types</SelectItem>
                {uniqueTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.dayOfWeek}
              onValueChange={(value) => updateFilter("dayOfWeek", value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Day of week" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All days</SelectItem>
                {uniqueDays.map((day) => (
                  <SelectItem key={day} value={day}>
                    {day}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Date"
              value={filters.date}
              onChange={(event) => updateFilter("date", event.target.value)}
            />
            <Input
              placeholder="Time"
              value={filters.time}
              onChange={(event) => updateFilter("time", event.target.value)}
            />
            <Input
              placeholder="Duration"
              value={filters.duration}
              onChange={(event) => updateFilter("duration", event.target.value)}
            />
            <Input
              placeholder="Session name"
              value={filters.sessionName}
              onChange={(event) => updateFilter("sessionName", event.target.value)}
            />
            <Input
              placeholder="Instructor"
              value={filters.instructor}
              onChange={(event) => updateFilter("instructor", event.target.value)}
            />
            <Input
              placeholder="Room"
              value={filters.room}
              onChange={(event) => updateFilter("room", event.target.value)}
            />
            <Input
              placeholder="Min booked"
              type="number"
              inputMode="numeric"
              value={filters.bookedMin}
              onChange={(event) => updateFilter("bookedMin", event.target.value)}
            />
            <Input
              placeholder="Min total spots"
              type="number"
              inputMode="numeric"
              value={filters.totalSpotsMin}
              onChange={(event) =>
                updateFilter("totalSpotsMin", event.target.value)
              }
            />
            <Input
              placeholder="Min spots available"
              type="number"
              inputMode="numeric"
              value={filters.spotsAvailableMin}
              onChange={(event) =>
                updateFilter("spotsAvailableMin", event.target.value)
              }
            />
            <Input
              placeholder="Min cumulative bookings"
              type="number"
              inputMode="numeric"
              value={filters.cumulativeBookingsMin}
              onChange={(event) =>
                updateFilter("cumulativeBookingsMin", event.target.value)
              }
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={resetFilters}>
              Reset filters
            </Button>
            <div className="text-sm text-muted-foreground">
              Showing {visibleRows.length} of {sortedData.length} filtered sessions (total {data.length}).
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Combined sessions</CardTitle>
            <CardDescription>All CSV sources in a single, filterable table.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSortPanelOpen(true)}
              className="whitespace-nowrap"
            >
              <ArrowUpDown className="mr-2 h-4 w-4" />
              Sort columns
            </Button>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                const size = Number(value);
                setPageSize(size);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Rows" />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option} / page
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                {(
                  [
                    { column: "source" as const, label: "Source", align: "left" },
                    { column: "date" as const, label: "Date", align: "left" },
                    { column: "time" as const, label: "Time", align: "left" },
                    { column: "location" as const, label: "Location", align: "left" },
                    { column: "sessionName" as const, label: "Session", align: "left" },
                    { column: "sessionType" as const, label: "Type", align: "left" },
                    { column: "instructor" as const, label: "Instructor", align: "left" },
                    { column: "room" as const, label: "Room", align: "left" },
                    { column: "booked" as const, label: "Booked", align: "right" },
                    { column: "totalSpots" as const, label: "Spots", align: "right" },
                    { column: "spotsAvailable" as const, label: "Avail.", align: "right" },
                    { column: "fillRate" as const, label: "Fill rate", align: "right" },
                    { column: "cumulativeBookings" as const, label: "Cumulative", align: "right" },
                  ] satisfies Array<{ column: SortColumn; label: string; align: "left" | "right" }>
                ).map(({ column, label, align }) => {
                  const priorityInfo = priorityMap.get(column);
                  const priorityBadge = priorityInfo
                    ? priorityInfo.index + 1
                    : null;
                  const isActive = !!priorityInfo;
                  const direction = priorityInfo?.direction;

                  return (
                    <SortableHeader
                      key={column}
                      column={column}
                      align={align}
                      isActive={isActive}
                      direction={direction}
                      priority={priorityBadge}
                      priorityDirection={priorityInfo?.direction}
                      onSort={handleSort}
                    >
                      {label}
                    </SortableHeader>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={13} className="h-24 text-center text-sm text-muted-foreground">
                    No sessions match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                visibleRows.map((record) => (
                  <TableRow key={record.id} data-record-id={record.id}>
                    <TableCell>{record.source}</TableCell>
                    <TableCell>{record.date}</TableCell>
                    <TableCell>{record.time}</TableCell>
                    <TableCell>{record.location}</TableCell>
                    <TableCell>
                      <div className="font-medium">{record.sessionName}</div>
                      <div className="text-xs text-muted-foreground">{record.dayOfWeek}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{record.sessionType}</Badge>
                    </TableCell>
                    <TableCell>{record.instructor || "—"}</TableCell>
                    <TableCell>{record.room || "—"}</TableCell>
                    <TableCell className="text-right font-medium">
                      {record.booked.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {record.totalSpots.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {record.spotsAvailable.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {(record.fillRate * 100).toFixed(0)}%
                    </TableCell>
                    <TableCell className="text-right">
                      {record.cumulativeBookings.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
        <div className="flex items-center justify-between border-t px-6 py-4 text-sm">
          <div>
            Page {currentPage + 1} of {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 0}
              onClick={() => setPage((prev) => Math.max(0, prev - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages - 1}
              onClick={() => setPage((prev) => Math.min(totalPages - 1, prev + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  </>
  );
}
