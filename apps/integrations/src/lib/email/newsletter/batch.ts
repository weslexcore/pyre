import { createHash } from 'node:crypto';
import type { CreateBatchEmailOptions } from 'resend';
import { type NewsletterTemplate, personalize } from './render';

// The pure half of a newsletter send: one batch of copies, ready for Resend's
// batch endpoint (up to 100 emails a call). The send job (./send-job.ts) owns
// the database and the pacing.

/** The email_sends template key and Resend tag for every newsletter copy. */
export const NEWSLETTER_TEMPLATE = 'newsletter';

/** Resend's batch endpoint takes at most 100 emails a call. */
export const BATCH_SIZE = 100;

/** One person's copy of one issue, claimed in email_sends before it is sent. */
export function newsletterSendKey(newsletterId: string, email: string): string {
  return `newsletter:${newsletterId}:${email.toLowerCase()}`;
}

/**
 * Resend's idempotency key for a batch: the same people in the same issue give
 * the same key, so a batch retried after a timeout (claims released, rebuilt
 * on the next run) is not delivered twice. Resend keeps keys for 24 hours.
 */
export function batchIdempotencyKey(newsletterId: string, sendKeys: readonly string[]): string {
  const digest = createHash('sha256').update(sendKeys.join('\n')).digest('hex').slice(0, 32);
  return `newsletter-${newsletterId}-${digest}`;
}

export interface BatchRecipient {
  email: string;
  firstName?: string | null;
  unsubscribeUrl: string;
}

export interface BatchCopy {
  email: string;
  subject: string;
  payload: CreateBatchEmailOptions;
}

/** Each recipient's personal copy, with the one-click unsubscribe headers and tags. */
export function buildBatch(
  template: NewsletterTemplate,
  recipients: readonly BatchRecipient[],
  { from, campaign }: { from: string; campaign: string }
): BatchCopy[] {
  return recipients.map((recipient) => {
    const copy = personalize(template, recipient);
    return {
      email: recipient.email,
      subject: copy.subject,
      payload: {
        from,
        to: recipient.email,
        subject: copy.subject,
        html: copy.html,
        text: copy.text,
        headers: {
          'List-Unsubscribe': `<${recipient.unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
        tags: [
          { name: 'template', value: NEWSLETTER_TEMPLATE },
          { name: 'kind', value: 'marketing' },
          { name: 'campaign', value: campaign },
        ],
      },
    };
  });
}

/**
 * Lines a permissive batch response up with the copies sent. Resend lists the
 * emails it refused by index and returns ids for the rest, in order. When the
 * counts don't add up, the ids are left off rather than pinned to the wrong
 * people (attribution then falls back to the tags).
 */
export function matchBatchResults(
  count: number,
  ids: readonly { id: string }[],
  errors: readonly { index: number; message: string }[]
): { id?: string; error?: string }[] {
  const refused = new Map(errors.map((e) => [e.index, e.message]));
  const accepted = count - refused.size;
  const aligned = ids.length === accepted;
  let next = 0;
  return Array.from({ length: count }, (_, i) => {
    const error = refused.get(i);
    if (error !== undefined) return { error };
    const id = aligned ? ids[next]?.id : undefined;
    next++;
    return id ? { id } : {};
  });
}
