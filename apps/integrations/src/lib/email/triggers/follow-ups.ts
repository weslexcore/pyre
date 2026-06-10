// STRUCTURE-ONLY STUB — not wired up yet.
//
// Future: a scheduled (cron) job that emails members a follow-up after a session
// completes (e.g. T+1d "how was it?" / rebooking nudge). Same shape as reminders:
// enumerate recently-completed bookings, dedupe via `followup:{sessionBookingId}`,
// send through sendTemplate().

export interface FollowUpJobResult {
  scanned: number;
  sent: number;
  skipped: number;
}

export async function runFollowUps(): Promise<FollowUpJobResult> {
  // TODO: implement scheduled follow-up sweep.
  return { scanned: 0, sent: 0, skipped: 0 };
}
