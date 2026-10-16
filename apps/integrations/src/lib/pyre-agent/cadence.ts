// When a Pyre Agent routine runs: daily, on chosen weekdays, or on a day of
// the month, at an hour on the studio's wall clock (Eastern). Pure and
// client-bundle-safe — the form previews the next run with the same math the
// runner schedules by — and DST-correct, because every slot is a wall-clock
// date and hour turned into an instant by easternToUtc.

import { addDays, easternDate, easternToUtc } from '@pyre/schedule-core';

export const FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export interface Cadence {
  frequency: Frequency;
  /** 0 = Sunday … 6 = Saturday; used when weekly. */
  weekdays: number[];
  /** 1–28; used when monthly. */
  monthDay: number | null;
  /** 0–23, Eastern. */
  hour: number;
}

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const ROUTINE_LIMITS = { title: 100, prompt: 2000 } as const;

/** Far enough to find any slot (a monthly one is at most ~31 days off). */
const SEARCH_DAYS = 62;

function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function runsOn(cadence: Cadence, date: string): boolean {
  switch (cadence.frequency) {
    case 'daily':
      return true;
    case 'weekly':
      return cadence.weekdays.includes(weekdayOf(date));
    case 'monthly':
      return Number(date.slice(8, 10)) === cadence.monthDay;
  }
}

/** The first slot strictly after `after`, as an ISO instant; null if the cadence has none. */
export function nextRunAt(cadence: Cadence, after: Date): string | null {
  const start = easternDate(after);
  const hour = `${String(cadence.hour).padStart(2, '0')}:00`;
  for (let offset = 0; offset <= SEARCH_DAYS; offset += 1) {
    const date = addDays(start, offset);
    if (!runsOn(cadence, date)) continue;
    const at = easternToUtc(date, hour);
    if (Date.parse(at) > after.getTime()) return at;
  }
  return null;
}

/** "8am", "12pm", "5pm". */
export function formatHour(hour: number): string {
  const suffix = hour < 12 ? 'am' : 'pm';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${suffix}`;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** "Mondays at 8am", "Every day at 6pm", "The 1st of each month at 9am". */
export function describeCadence(cadence: Cadence): string {
  const at = `at ${formatHour(cadence.hour)}`;
  switch (cadence.frequency) {
    case 'daily':
      return `Every day ${at}`;
    case 'weekly': {
      const days = [...cadence.weekdays].sort((a, b) => a - b);
      if (days.length === 7) return `Every day ${at}`;
      if (days.join() === '1,2,3,4,5') return `Weekdays ${at}`;
      const names = days.map((d) => `${WEEKDAY_NAMES[d]}s`);
      const list =
        names.length <= 2
          ? names.join(' and ')
          : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
      return `${list} ${at}`;
    }
    case 'monthly':
      return `The ${ordinal(cadence.monthDay ?? 1)} of each month ${at}`;
  }
}

export interface RoutineInput {
  title: string;
  prompt: string;
  cadence: Cadence;
  enabled: boolean;
}

export type RoutineParse = { ok: true; value: RoutineInput } | { ok: false; error: string };

/** A create or edit body, checked: { title, prompt, frequency, weekdays?, monthDay?, hour, enabled? }. */
export function parseRoutineInput(body: Record<string, unknown>): RoutineParse {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > ROUTINE_LIMITS.title) {
    return { ok: false, error: `Give it a name of 1–${ROUTINE_LIMITS.title} characters` };
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt || prompt.length > ROUTINE_LIMITS.prompt) {
    return { ok: false, error: `The request must be 1–${ROUTINE_LIMITS.prompt} characters` };
  }
  const frequency = body.frequency;
  if (typeof frequency !== 'string' || !(FREQUENCIES as readonly string[]).includes(frequency)) {
    return { ok: false, error: 'frequency must be daily, weekly, or monthly' };
  }
  const hour = typeof body.hour === 'number' ? body.hour : Number(body.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return { ok: false, error: 'hour must be 0–23' };
  }
  let weekdays: number[] = [];
  if (frequency === 'weekly') {
    if (!Array.isArray(body.weekdays)) return { ok: false, error: 'Pick at least one day' };
    weekdays = [...new Set(body.weekdays.map(Number))].filter(
      (d) => Number.isInteger(d) && d >= 0 && d <= 6
    );
    if (weekdays.length === 0) return { ok: false, error: 'Pick at least one day' };
    weekdays.sort((a, b) => a - b);
  }
  let monthDay: number | null = null;
  if (frequency === 'monthly') {
    monthDay = Number(body.monthDay);
    if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 28) {
      return { ok: false, error: 'Day of the month must be 1–28' };
    }
  }
  return {
    ok: true,
    value: {
      title,
      prompt,
      cadence: { frequency: frequency as Frequency, weekdays, monthDay, hour },
      enabled: body.enabled !== false,
    },
  };
}

/** A routine as the page reads it. */
export interface RoutineView {
  id: string;
  title: string;
  prompt: string;
  cadence: Cadence;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRun: {
    status: 'running' | 'answered' | 'failed';
    sessionId: string | null;
    error: string | null;
    startedAt: string;
  } | null;
}

/** Starting points the page offers; the first is the weekly team update. */
export const ROUTINE_PRESETS: { title: string; prompt: string; cadence: Cadence }[] = [
  {
    title: 'Weekly shift notes summary',
    prompt:
      'Read every shift note from the past seven days and summarize the week for our weekly team update. Group it into: guest feedback (praise and complaints), maintenance and facility issues, supplies and inventory, staffing and handoffs, and anything still unresolved that needs an owner. Call out patterns that came up more than once, quote short lines where they help, and link each point to its note. End with three to five suggested talking points for the team update.',
    cadence: { frequency: 'weekly', weekdays: [1], monthDay: null, hour: 8 },
  },
  {
    title: 'Monday goals status',
    prompt:
      'Give me a status update on every active goal: pace, tasks done of total, each KPI against its target, and days left. Lead with anything behind or overdue, then list overdue cards and cards waiting on someone, with who is on each.',
    cadence: { frequency: 'weekly', weekdays: [1], monthDay: null, hour: 9 },
  },
  {
    title: 'Daily water log check',
    prompt:
      'Check the cold tub water log for the last 24 hours. Flag any reading outside the ranges in the water care SOP, any tub with no test logged, and anything noted that needs follow-up.',
    cadence: { frequency: 'daily', weekdays: [], monthDay: null, hour: 7 },
  },
];
