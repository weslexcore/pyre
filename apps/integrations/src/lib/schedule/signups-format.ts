// Client-safe half of the signups feature: the shape the board island
// receives and the label it renders. Kept apart from signups.ts, which pulls
// in Redis and the Momence host API and must stay server-only.

/** Guests per shift id. Cancelled shifts get no entry; every other shift gets one (0 if empty). */
export type ShiftSignups = Record<string, number>;

export function formatSignups(count: number): string {
  return `${count} signup${count === 1 ? '' : 's'}`;
}
