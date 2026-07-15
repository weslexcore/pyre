import { setSubscriberStatus } from '@pyre/webhook-core';
import { getDb } from '@/lib/db';
import { markResendContactUnsubscribed } from './audience';

// The single source of truth for marketing suppression is the Supabase
// email_suppressions table. Resend and Mailchimp are downstream mirrors
// (propagated here, best-effort); Momence opt-outs arrive as an upstream input.
// sendTemplate() consults isSuppressed() before every marketing send.

export type SuppressionReason = 'unsubscribe' | 'complaint' | 'bounce' | 'momence' | 'manual';

export async function isSuppressed(email: string): Promise<boolean> {
  const db = getDb();
  // Fail CLOSED for marketing email: without the suppression store we cannot
  // prove consent, so treat everyone as suppressed rather than risk emailing
  // someone who opted out.
  if (!db) return true;

  const { data, error } = await db
    .from('email_suppressions')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (error) {
    console.error(`[Suppression] Lookup failed for ${email}: ${error.message}`);
    return true;
  }

  return data !== null;
}

export interface SuppressInput {
  email: string;
  reason: SuppressionReason;
  source: string;
}

// Record a suppression and mirror it outward. Insert is idempotent (unique
// email, first reason wins); propagation failures are logged, not thrown — the
// authoritative record is already saved.
export async function suppressEmail({ email, reason, source }: SuppressInput): Promise<void> {
  const normalized = email.toLowerCase();
  const db = getDb();

  if (!db) {
    throw new Error('Supabase not configured — cannot record suppression');
  }

  const { error } = await db
    .from('email_suppressions')
    .upsert({ email: normalized, reason, source }, { onConflict: 'email', ignoreDuplicates: true });

  if (error) {
    throw new Error(`Failed to record suppression for ${normalized}: ${error.message}`);
  }

  console.info(`[Suppression] ${normalized} suppressed (${reason} via ${source})`);

  await Promise.allSettled([
    markResendContactUnsubscribed(normalized),
    setSubscriberStatus(normalized, 'unsubscribed').catch((err) => {
      console.warn(`[Suppression] Mailchimp mirror failed for ${normalized}:`, err);
    }),
  ]);
}
