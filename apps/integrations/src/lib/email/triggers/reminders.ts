// STRUCTURE-ONLY STUB — not wired up yet.
//
// Future: a scheduled (cron) job that emails members a reminder ahead of an
// upcoming session (e.g. T-24h / T-2h). Will enumerate upcoming bookings from
// Momence, dedupe via idempotency keys (`reminder:{sessionBookingId}:{offset}`),
// and route through sendTemplate() so the dev-mode gate applies automatically.
//
// Cron wiring will live in vercel.json `crons` -> an API route under
// src/pages/api/cron/reminders.ts that calls runReminders().

export interface ReminderJobResult {
  scanned: number;
  sent: number;
  skipped: number;
}

export async function runReminders(): Promise<ReminderJobResult> {
  // TODO: implement scheduled reminder sweep.
  return { scanned: 0, sent: 0, skipped: 0 };
}
