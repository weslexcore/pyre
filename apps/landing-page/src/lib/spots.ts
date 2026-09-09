// Slot-availability formatting shared by every surface that shows an event's
// remaining spots — the schedule rows, the detail modal, and the event page.

/** Tailwind text colour for a remaining-spots count: red at zero, gold when scarce. */
export function spotsColor(spots: number | undefined): string {
  if (spots === undefined) return 'text-[var(--pyre-creme)] opacity-70';
  if (spots === 0) return 'text-[var(--pyre-red)]';
  if (spots <= 3) return 'text-[var(--pyre-gold)]';
  return 'text-[var(--pyre-creme)] opacity-70';
}

/** "12/30 open" / "3 open" / "Waitlist", or null when capacity is unknown. */
export function spotsLabel(
  spotsRemaining: number | undefined,
  totalSpots: number | undefined
): string | null {
  if (spotsRemaining === undefined) return null;
  if (spotsRemaining === 0) return 'Waitlist';
  if (totalSpots !== undefined) return `${spotsRemaining}/${totalSpots} open`;
  return `${spotsRemaining} open`;
}

// Duration-only label for a booking row, e.g. "1 Hour" / "2 Hours". Non-whole
// hours fall back to a minutes label, then to stripping the "Book " prefix from
// the option label when the duration is unknown.
export function durationRowLabel(minutes: number, fallbackLabel = ''): string {
  if (minutes > 0 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} Hour${hours > 1 ? 's' : ''}`;
  }
  if (minutes > 0) return `${minutes} Min`;
  return fallbackLabel.replace(/^Book\s+/i, '');
}
