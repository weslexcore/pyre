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
