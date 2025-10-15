import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionRecord } from "@/lib/data";
import { DataTable } from "./data-table";

const STORAGE_KEY = "pyre:data-dashboard:data-table-sort";
const BOOKED_COLUMN_INDEX = 8;

const BASE_RECORDS: SessionRecord[] = [
  {
    id: "session-beta",
    source: "Studio Beta",
    file: "beta.csv",
    date: "04/02/2024",
    time: "5:00 PM",
    duration: "60 minutes",
    location: "Beta Hall",
    sessionName: "Beta Breathwork",
    sessionType: "Guided",
    instructor: "Bella",
    room: "Room 2",
    spotsAvailable: 50,
    totalSpots: 100,
    booked: 50,
    cumulativeBookings: 500,
    timestamp: "2024-04-02T17:00:00.000Z",
    dayOfWeek: "Tuesday",
    fillRate: 0.5,
  },
  {
    id: "session-alpha",
    source: "Studio Alpha",
    file: "alpha.csv",
    date: "04/01/2024",
    time: "6:30 PM",
    duration: "75 minutes",
    location: "Alpha Loft",
    sessionName: "Alpha Flow",
    sessionType: "Fitness",
    instructor: "Avery",
    room: "Room 1",
    spotsAvailable: 10,
    totalSpots: 80,
    booked: 70,
    cumulativeBookings: 700,
    timestamp: "2024-04-01T18:30:00.000Z",
    dayOfWeek: "Monday",
    fillRate: 0.875,
  },
  {
    id: "session-gamma",
    source: "Studio Gamma",
    file: "gamma.csv",
    date: "03/30/2024",
    time: "8:00 AM",
    duration: "45 minutes",
    location: "Gamma Studio",
    sessionName: "Gamma Sunrise",
    sessionType: "Guided",
    instructor: "Gina",
    room: "Outdoor Deck",
    spotsAvailable: 20,
    totalSpots: 60,
    booked: 40,
    cumulativeBookings: 400,
    timestamp: "2024-03-30T08:00:00.000Z",
    dayOfWeek: "Saturday",
    fillRate: 0.6667,
  },
];

function buildSampleData(): SessionRecord[] {
  return BASE_RECORDS.map((record) => ({ ...record }));
}

function renderTable(records: SessionRecord[] = buildSampleData()) {
  return render(<DataTable data={records} />);
}

function getRowIds(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLTableRowElement>("[data-record-id]"),
    (row) => row.getAttribute("data-record-id") ?? "",
  );
}

function getBookedValues(): number[] {
  return Array.from(
    document.querySelectorAll<HTMLTableRowElement>("[data-record-id]"),
    (row) => {
      const cell = row.querySelectorAll("td")[BOOKED_COLUMN_INDEX];
      if (!cell) {
        throw new Error("Booked cell not found in row.");
      }
      return Number(
        cell.textContent?.replace(/,/g, "").trim() ?? Number.NaN,
      );
    },
  );
}

function getColumnHeader(label: string): HTMLTableCellElement {
  const button = screen.getByRole("button", {
    name: new RegExp(`Sort by ${label}`, "i"),
  });
  const header = button.closest("th");
  if (!header) {
    throw new Error(`Header for ${label} not found.`);
  }
  return header;
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

test("shows newest sessions first by default", () => {
  renderTable();

  expect(getRowIds()).toEqual([
    "session-beta",
    "session-alpha",
    "session-gamma",
  ]);

  expect(getColumnHeader("Date")).toHaveAttribute("aria-sort", "descending");
});

test("allows sorting by booked with click and keyboard interaction", async () => {
  const user = userEvent.setup();
  renderTable();

  const bookedButton = screen.getByRole("button", {
    name: /Sort by Booked/i,
  });

  await user.click(bookedButton);

  expect(getBookedValues()).toEqual([70, 50, 40]);
  expect(getColumnHeader("Booked")).toHaveAttribute("aria-sort", "descending");

  act(() => {
    bookedButton.focus();
  });
  expect(bookedButton).toHaveFocus();
  await user.keyboard("{Enter}");

  await waitFor(() => {
    expect(getBookedValues()).toEqual([40, 50, 70]);
    expect(getColumnHeader("Booked")).toHaveAttribute("aria-sort", "ascending");
  });
});

test("persists sort selection to session storage and restores it on mount", async () => {
  const user = userEvent.setup();
  const instance = renderTable();

  const bookedButton = screen.getByRole("button", {
    name: /Sort by Booked/i,
  });

  await user.click(bookedButton);

  const stored = sessionStorage.getItem(STORAGE_KEY);
  expect(stored).not.toBeNull();
  const payload = JSON.parse(stored ?? "{}");
  expect(payload.version).toBe(2);
  expect(Array.isArray(payload.stack)).toBe(true);
  expect(payload.stack?.[0]).toMatchObject({
    column: "booked",
    direction: "desc",
  });
  expect(typeof payload.signature).toBe("string");

  instance.unmount();
  renderTable();

  await waitFor(() =>
    expect(getColumnHeader("Booked")).toHaveAttribute(
      "aria-sort",
      "descending",
    ),
  );
  expect(getBookedValues()).toEqual([70, 50, 40]);
});

test("retains filter behaviour alongside sorting", async () => {
  const user = userEvent.setup();
  renderTable();

  const searchInput = screen.getByPlaceholderText(/Search everything/i);

  await user.type(searchInput, "Gamma");

  await waitFor(() => {
    expect(getRowIds()).toEqual(["session-gamma"]);
  });
  expect(
    screen.getByText(/Showing 1 of 1 filtered sessions/i),
  ).toBeInTheDocument();

  await user.clear(searchInput);

  await waitFor(() => {
    expect(getRowIds()).toEqual([
      "session-beta",
      "session-alpha",
      "session-gamma",
    ]);
  });
});
