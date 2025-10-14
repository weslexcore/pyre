"use client";

import { useMemo, useState } from "react";
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

const PAGE_SIZE_OPTIONS = [25, 50, 100];

export function DataTable({ data }: { data: SessionRecord[] }) {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const [page, setPage] = useState(0);

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

  const totalPages = Math.max(1, Math.ceil(filteredData.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const visibleRows = useMemo(() => {
    const start = currentPage * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, currentPage, pageSize]);

  function updateFilter<Key extends keyof FilterState>(key: Key, value: FilterState[Key]) {
    setPage(0);
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    setPage(0);
  }

  return (
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
              Showing {visibleRows.length} of {filteredData.length} filtered sessions (total {data.length}).
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
                <TableHead>Source</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Session</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Instructor</TableHead>
                <TableHead>Room</TableHead>
                <TableHead className="text-right">Booked</TableHead>
                <TableHead className="text-right">Spots</TableHead>
                <TableHead className="text-right">Avail.</TableHead>
                <TableHead className="text-right">Fill rate</TableHead>
                <TableHead className="text-right">Cumulative</TableHead>
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
                  <TableRow key={record.id}>
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
  );
}
