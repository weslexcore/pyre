// Request-body normalization for shift notes, shared by the API route and the
// island (client-bundle-safe: no db/env imports — the composer caps its
// textarea at the same number the server rejects at). Identity columns
// (author_email, updated_by) are set by the route from the session and are
// deliberately not part of this contract.

/** Matches the shift_notes body check constraint. */
export const NOTE_BODY_MAX = 8000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A real YYYY-MM-DD calendar date (the wall-clock date shape the schedule
 * tables use) — the regex alone would wave through Feb 31.
 */
export function isNoteDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Trimmed note body, or null when it's not a usable string. */
export function normalizeBody(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const body = value.trim();
  if (!body || body.length > NOTE_BODY_MAX) return null;
  return body;
}

/**
 * Today's date in the shift wall-clock timezone (America/New_York), as the
 * composer's default. en-CA formats as YYYY-MM-DD.
 */
export function todayEastern(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
