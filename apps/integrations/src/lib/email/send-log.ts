import { getDb } from '@/lib/db';

// Append-only send log in Supabase (email_sends). Two jobs:
//  1. Audit trail — every email the app sends, queryable by recipient/journey.
//  2. Long-horizon dedupe — rows with a send_key are claimed via unique-index
//     insert BEFORE sending, so "once per lifetime" sends (review request,
//     journey steps) can never double-fire even across concurrent sweeps.
// Short-horizon webhook-retry dedupe stays in Redis (lib/email/idempotency.ts).

export interface SendLogEntry {
  email: string;
  memberId?: number;
  template: string;
  kind: 'transactional' | 'marketing';
  journeyId?: string;
  stepId?: string;
  campaign?: string;
  sendKey?: string;
}

type ClaimResult =
  | { outcome: 'claimed'; id: string }
  | { outcome: 'duplicate' }
  | { outcome: 'unavailable' };

// Claim a send_key by inserting the row before the send happens. A unique-index
// conflict means some other run already sent (or is sending) this email.
export async function claimSend(entry: SendLogEntry): Promise<ClaimResult> {
  const db = getDb();
  if (!db) return { outcome: 'unavailable' };

  const { data, error } = await db
    .from('email_sends')
    .insert(toRow(entry, 'sent'))
    .select('id')
    .maybeSingle();

  if (error) {
    // 23505 = unique_violation on send_key
    if (error.code === '23505') return { outcome: 'duplicate' };
    console.error(`[SendLog] Claim failed for ${entry.sendKey}: ${error.message}`);
    return { outcome: 'unavailable' };
  }

  return { outcome: 'claimed', id: data?.id as string };
}

// Release a claim after a failed send so a later sweep can retry. (At-most-once
// beats at-least-once for marketing email; the window where neither happens is
// acceptable.)
export async function releaseSend(id: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  const { error } = await db.from('email_sends').delete().eq('id', id);
  if (error) console.error(`[SendLog] Release failed for ${id}: ${error.message}`);
}

export async function attachResendId(id: string, resendId: string | undefined): Promise<void> {
  if (!resendId) return;
  const db = getDb();
  if (!db) return;
  const { error } = await db.from('email_sends').update({ resend_id: resendId }).eq('id', id);
  if (error) console.error(`[SendLog] Could not attach resend id to ${id}: ${error.message}`);
}

// Plain audit-log write for sends that dedupe elsewhere (transactional
// confirmations use Redis idempotency). Never throws — logging must not break
// the send path.
export async function recordSend(
  entry: SendLogEntry,
  status: 'sent' | 'skipped' | 'suppressed' | 'failed',
  resendId?: string
): Promise<void> {
  const db = getDb();
  if (!db) return;

  const { error } = await db
    .from('email_sends')
    .insert({ ...toRow(entry, status), resend_id: resendId ?? null });

  if (error) {
    console.error(`[SendLog] Record failed for ${entry.email}/${entry.template}: ${error.message}`);
  }
}

function toRow(entry: SendLogEntry, status: string) {
  return {
    email: entry.email.toLowerCase(),
    member_id: entry.memberId ?? null,
    template: entry.template,
    kind: entry.kind,
    journey_id: entry.journeyId ?? null,
    step_id: entry.stepId ?? null,
    campaign: entry.campaign ?? null,
    send_key: entry.sendKey ?? null,
    status,
  };
}
