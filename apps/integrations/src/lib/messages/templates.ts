// Message templates: field limits for the template-only parts, and the date
// placeholders a template's title and body may hold. Placeholders are filled
// when someone starts a message from the template — on the studio's clock,
// so "this week" is the same week for everyone — and anything that isn't a
// known placeholder is left exactly as written. Client-bundle-safe: the
// composer fills templates in the browser and the editor lists the
// placeholders it offers.

import { STUDIO_TZ } from '@pyre/schedule-core';

export const TEMPLATE_NAME_MAX = 100;

/** Trimmed template name, or '' when blank or over the limit. */
export function normalizeTemplateName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const name = value.trim();
  return name.length > 0 && name.length <= TEMPLATE_NAME_MAX ? name : '';
}

export interface TemplatePlaceholder {
  token: string;
  label: string;
}

/** What the template editor offers, in the order it lists them. */
export const TEMPLATE_PLACEHOLDERS: TemplatePlaceholder[] = [
  { token: '{{date}}', label: 'today, e.g. Oct 16' },
  { token: '{{week_of}}', label: "this week's Monday, e.g. Oct 12" },
  { token: '{{next_week_of}}', label: "next week's Monday, e.g. Oct 19" },
];

/** Today's calendar date on the studio's clock, as a UTC-midnight Date. */
function studioToday(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: STUDIO_TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** 'Oct 16' for a UTC-midnight calendar date. */
function shortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

/** The values each placeholder fills in at `now`. Weeks start on Monday. */
export function placeholderValues(now: Date = new Date()): Record<string, string> {
  const today = studioToday(now);
  const sinceMonday = (today.getUTCDay() + 6) % 7;
  const monday = addDays(today, -sinceMonday);
  return {
    '{{date}}': shortDate(today),
    '{{week_of}}': shortDate(monday),
    '{{next_week_of}}': shortDate(addDays(monday, 7)),
  };
}

/** `text` with every known placeholder filled in for `now`. */
export function fillPlaceholders(text: string, now: Date = new Date()): string {
  const values = placeholderValues(now);
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) => {
    return values[`{{${key}}}`] ?? match;
  });
}
