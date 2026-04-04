import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { formatISO, parse as parseDate, format } from "date-fns";

const DATA_DIR = path.resolve(process.cwd(), "../data/sources");

export type SessionRecord = {
  id: string;
  source: string;
  file: string;
  date: string;
  time: string;
  duration: string;
  location: string;
  sessionName: string;
  sessionType: string;
  instructor: string;
  room: string;
  spotsAvailable: number;
  totalSpots: number;
  booked: number;
  cumulativeBookings: number;
  timestamp: string;
  dayOfWeek: string;
  fillRate: number;
};

type RawRecord = {
  Date: string;
  Time: string;
  Duration: string;
  Location: string;
  "Session Name": string;
  Instructor: string;
  Room: string;
  "Spots Available": string;
  "Total Spots": string;
  Booked: string;
  "Cumulative Bookings": string;
};

const DATE_FORMAT = "MM/dd/yyyy";
const DATETIME_FORMAT = "MM/dd/yyyy h:mm a";

function toTitle(value: string) {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeNumber(value: string) {
  const numeric = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function deriveSessionType(sessionName: string) {
  const name = sessionName.toLowerCase();
  if (name.includes("open hours") || name.includes("quiet flow")) {
    return "Open Hours";
  }
  if (name.includes("guided")) {
    return "Guided";
  }
  if (name.includes("private")) {
    return "Private";
  }
  if (name.includes("sound")) {
    return "Sound";
  }
  if (name.includes("social") || name.includes("dj")) {
    return "Social";
  }
  if (name.includes("pilates") || name.includes("yoga") || name.includes("run") || name.includes("hiit") || name.includes("fitness") || name.includes("tabata") || name.includes("lolu fit") || name.includes('boxing')) {
    return "Fitness";
  }
  if (name.includes("maintenance")) {
    return "Maintenance";
  }
  return "Special Event";
}

export async function loadSessions(): Promise<SessionRecord[]> {
  const files = await fs.readdir(DATA_DIR);

  const sessions: SessionRecord[] = [];

  for (const file of files) {
    if (!file.endsWith(".csv")) {
      continue;
    }

    const csvPath = path.join(DATA_DIR, file);
    const csvContent = await fs.readFile(csvPath, "utf8");
    const records = parseCsv(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as RawRecord[];

    const sourceLabel = toTitle(path.basename(file, ".csv"));

    for (const [index, record] of records.entries()) {
      const combined = parseDate(
        `${record.Date} ${record.Time}`,
        DATETIME_FORMAT,
        new Date(),
      );
      const timestamp = Number.isNaN(combined.getTime())
        ? formatISO(parseDate(record.Date, DATE_FORMAT, new Date()))
        : formatISO(combined);
      const dayOfWeek = Number.isNaN(combined.getTime())
        ? format(parseDate(record.Date, DATE_FORMAT, new Date()), "EEEE")
        : format(combined, "EEEE");

      const totalSpots = normalizeNumber(record["Total Spots"] ?? "0");
      const booked = normalizeNumber(record.Booked ?? "0");
      const fillRate = totalSpots > 0 ? booked / totalSpots : 0;

      sessions.push({
        id: `${file}-${index}`,
        source: sourceLabel,
        file,
        date: record.Date,
        time: record.Time,
        duration: record.Duration,
        location: record.Location,
        sessionName: record["Session Name"],
        sessionType: deriveSessionType(record["Session Name"] ?? ""),
        instructor: record.Instructor,
        room: record.Room,
        spotsAvailable: normalizeNumber(record["Spots Available"] ?? "0"),
        totalSpots,
        booked,
        cumulativeBookings: normalizeNumber(
          record["Cumulative Bookings"] ?? "0",
        ),
        timestamp,
        dayOfWeek,
        fillRate,
      });
    }
  }

  return sessions.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}
