// UTC → America/New_York wall-clock conversion for Momence timestamps. Uses
// Intl (no dependency); DST is handled by the timezone database.

const ET_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export interface LocalWallClock {
  /** YYYY-MM-DD in America/New_York. */
  date: string;
  /** Minutes since local midnight. */
  minutes: number;
}

/** Convert a UTC ISO timestamp (e.g. Momence startsAt) to ET wall-clock. */
export function utcToEastern(iso: string): LocalWallClock {
  const parts = ET_FORMAT.formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  // en-CA hour can render midnight as '24'; normalize.
  const hour = Number.parseInt(get('hour'), 10) % 24;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: hour * 60 + Number.parseInt(get('minute'), 10),
  };
}

/** The only two offsets America/New_York ever uses: EDT (-4) and EST (-5). */
const ET_OFFSET_HOURS = [4, 5];

/**
 * The inverse: the UTC instant an ET wall clock names. Needed wherever stored
 * wall-clock shift times have to become a real instant — the Google and
 * Outlook "add to calendar" links being the first case. (The .ics feed doesn't
 * need this; it names the wall clock directly with TZID.)
 *
 * No DST table and no iteration: a wall clock in this zone can only map to one
 * of two instants, so both are tried and checked against utcToEastern. That
 * makes the two awkward cases explicit rather than accidental —
 *
 *   ambiguous (fall back, 01:30 on Nov 1 happens twice) -> the first, EDT
 *   nonexistent (spring forward, 02:30 on Mar 8 never happens) -> 03:30 EDT
 *
 * which is what calendar clients do with the same input.
 *
 * @param date YYYY-MM-DD
 * @param time HH:MM or HH:MM:SS
 * @returns ISO 8601 UTC, e.g. '2026-08-14T18:00:00.000Z'
 */
export function easternToUtc(date: string, time: string): string {
  const [h = '0', m = '0', s = '0'] = time.split(':');
  const wantMinutes = Number.parseInt(h, 10) * 60 + Number.parseInt(m, 10);
  const naive =
    Date.parse(`${date}T00:00:00.000Z`) +
    wantMinutes * 60_000 +
    (Number.parseInt(s, 10) || 0) * 1000;

  // Ascending, so [0] is the earlier instant and the last is the later one.
  const candidates = ET_OFFSET_HOURS.map((offset) => naive + offset * 3_600_000);
  const exact = candidates.filter((t) => {
    const local = utcToEastern(new Date(t).toISOString());
    return local.date === date && local.minutes === wantMinutes;
  });

  // No exact match means the wall clock falls in the spring-forward gap; the
  // later candidate lands just past the transition.
  return new Date(exact[0] ?? candidates[candidates.length - 1]).toISOString();
}
