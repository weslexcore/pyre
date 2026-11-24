import { setSubscriberStatus } from '@pyre/webhook-core';
import { getDb } from '@/lib/db';
import { markResendContactUnsubscribed } from './audience';

// The single source of truth for marketing suppression is the Supabase
// email_suppressions table. Resend and Mailchimp are downstream mirrors
// (propagated here, best-effort); Momence opt-outs arrive as an upstream input.
// sendTemplate() consults isSuppressed() before every marketing send.

export type SuppressionReason = 'unsubscribe' | 'complaint' | 'bounce' | 'momence' | 'manual';

/**
 * Whether an address is on the suppression list: true, false, or null when the
 * list cannot be read (no database, or the lookup failed). Callers decide what
 * an unknown answer means for them.
 */
export async function lookupSuppression(email: string): Promise<boolean | null> {
  const db = getDb();
  if (!db) return null;

  const { data, error } = await db
    .from('email_suppressions')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (error) {
    console.error(`[Suppression] Lookup failed for ${email}: ${error.message}`);
    return null;
  }

  return data !== null;
}

export async function isSuppressed(email: string): Promise<boolean> {
  // Fail CLOSED for marketing email: without the suppression store we cannot
  // prove consent, so treat everyone as suppressed rather than risk emailing
  // someone who opted out.
  return (await lookupSuppression(email)) ?? true;
}

export interface SuppressInput {
  email: string;
  reason: SuppressionReason;
  source: string;
}

// Record a suppression and mirror it outward. Insert is idempotent (unique
// email, first reason wins); propagation failures are logged, not thrown — the
// authoritative record is already saved, and the daily resend-reconcile job
// (lib/email/resend-sync.ts) repairs a Resend mirror that failed.
//
// Only a NEW suppression is mirrored. Marking a contact unsubscribed in Resend
// fires a contact.updated webhook, which lands back here; mirroring again on
// that echo would bounce between the two systems.
export async function suppressEmail({ email, reason, source }: SuppressInput): Promise<void> {
  const normalized = email.toLowerCase();
  const db = getDb();

  if (!db) {
    throw new Error('Supabase not configured — cannot record suppression');
  }

  const { data, error } = await db
    .from('email_suppressions')
    .upsert({ email: normalized, reason, source }, { onConflict: 'email', ignoreDuplicates: true })
    .select('id');

  if (error) {
    throw new Error(`Failed to record suppression for ${normalized}: ${error.message}`);
  }

  // ignoreDuplicates returns only the rows it inserted.
  if (!data || data.length === 0) {
    console.info(`[Suppression] ${normalized} already suppressed (${reason} via ${source})`);
    return;
  }

  console.info(`[Suppression] ${normalized} suppressed (${reason} via ${source})`);

  await Promise.allSettled([
    markResendContactUnsubscribed(normalized),
    setSubscriberStatus(normalized, 'unsubscribed').catch((err) => {
      console.warn(`[Suppression] Mailchimp mirror failed for ${normalized}:`, err);
    }),
  ]);
}
