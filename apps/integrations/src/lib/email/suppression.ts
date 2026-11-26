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

export type SuppressionMirror = 'resend' | 'mailchimp';

export interface SuppressInput {
  email: string;
  reason: SuppressionReason;
  source: string;
  /**
   * A mirror the suppression came from, and so must not be written back to.
   * The Resend contact.updated webhook passes 'resend': writing the unsubscribe
   * back onto the contact fires another contact.updated, which is a loop.
   */
  from?: SuppressionMirror;
}

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

// Record a suppression and mirror it outward. Insert is idempotent (unique
// email, first reason wins); propagation failures are logged, not thrown — the
// authoritative record is already saved, and nothing we send reads the
// mirrors (the newsletter send and journeys both check this table).
//
// Only a NEW suppression is mirrored. Marking a contact unsubscribed in Resend
// fires a contact.updated webhook, which lands back here; mirroring again on
// that echo would bounce between the two systems (it once ran at ~20 webhooks
// a second for a day, and filled the webhook execution index in Redis). "New"
// is decided by a plain insert and the unique violation it raises on a repeat.
export async function suppressEmail({ email, reason, source, from }: SuppressInput): Promise<void> {
  const normalized = email.toLowerCase();
  const db = getDb();

  if (!db) {
    throw new Error('Supabase not configured — cannot record suppression');
  }

  const { error } = await db
    .from('email_suppressions')
    .insert({ email: normalized, reason, source });

  if (error?.code === UNIQUE_VIOLATION) {
    console.info(`[Suppression] ${normalized} already suppressed (${reason} via ${source})`);
    return;
  }
  if (error) {
    throw new Error(`Failed to record suppression for ${normalized}: ${error.message}`);
  }

  console.info(`[Suppression] ${normalized} suppressed (${reason} via ${source})`);

  await Promise.allSettled([
    from === 'resend' ? Promise.resolve() : markResendContactUnsubscribed(normalized),
    from === 'mailchimp'
      ? Promise.resolve()
      : setSubscriberStatus(normalized, 'unsubscribed').catch((err) => {
          console.warn(`[Suppression] Mailchimp mirror failed for ${normalized}:`, err);
        }),
  ]);
}
