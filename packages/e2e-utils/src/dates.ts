// Fixture dates relative to "now", so fixtures never age into the past.

/**
 * ISO timestamp `days` from today at `utcHour:minute` UTC. Pick hours that land
 * mid-day in the app's timezone so a fixture never crosses a local midnight.
 */
export function daysFromNow(days: number, utcHour = 18, minute = 0, from = new Date()): string {
  const date = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + days, utcHour, minute)
  );
  return date.toISOString();
}
