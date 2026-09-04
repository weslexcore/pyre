// The "when to show up" line on the booking confirmation, computed from the
// session's actual start so the guest sees a clock time rather than a rule.
//
// Two policies, chosen per session type in confirmation-content.ts:
//   early - facilitated sessions (guided, classes, sound baths, events) start
//           together, so guests should be checked in before the start time.
//   late  - drop-in sessions (open hours, social) have a rolling arrival
//           window: anytime in the first hour is fine.

import { formatClockTime } from '@/lib/momence-events';

export type ArrivalPolicy = 'early' | 'late';

const EARLY_MINUTES = 15;
const LATE_WINDOW_MINUTES = 60;

export function buildArrivalLabel(policy: ArrivalPolicy, startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);

  if (policy === 'early') {
    const by = new Date(start.getTime() - EARLY_MINUTES * 60_000);
    return `Please arrive by ${formatClockTime(by)} to check in and get changed before we begin.`;
  }

  // The rolling window never runs past the end of a short session.
  const windowMs = Math.min(LATE_WINDOW_MINUTES * 60_000, end.getTime() - start.getTime());
  const windowEnd = new Date(start.getTime() + windowMs);
  return `Arrive anytime between ${formatClockTime(start)} and ${formatClockTime(windowEnd)} to check in and get changed.`;
}
