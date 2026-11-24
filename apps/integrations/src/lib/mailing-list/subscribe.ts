import { getDb } from '@/lib/db';

// The mailing list: newsletter_subscribers in Supabase. Joined from the
// landing page forms (the footer form, the promo popup, partner and
// link-in-bio pages, the volunteer page, relayed by the landing page's
// /api/mailing-list route, which owns the abuse checks), and by every Momence
// customer through the member webhook, as they were on Mailchimp.
//
// Joining never lifts a suppression: the form has no double opt-in, so a
// sign-up can't prove the owner of the address asked to come back, and anyone
// could type in someone else's. The newsletter send skips suppressed
// addresses, and the form gives everyone the same answer, so it never reveals
// who has opted out.

export const MAILING_LISTS = ['newsletter', 'volunteer'] as const;
export type MailingList = (typeof MAILING_LISTS)[number];

export function isMailingList(value: unknown): value is MailingList {
  return typeof value === 'string' && (MAILING_LISTS as readonly string[]).includes(value);
}

export type SubscribeOutcome =
  | { outcome: 'subscribed' }
  | { outcome: 'unavailable'; reason: string };

export interface SubscribeInput {
  email: string;
  list: MailingList;
  /** Where they joined: website_form, promo_popup, momence… ([a-z0-9_-], 60 max). */
  source: string;
  firstName?: string;
  lastName?: string;
}

export async function subscribeToMailingList({
  email,
  list,
  source,
  firstName,
  lastName,
}: SubscribeInput): Promise<SubscribeOutcome> {
  const db = getDb();
  if (!db) {
    console.error('[Mailing list] Supabase not configured');
    return { outcome: 'unavailable', reason: 'no-db' };
  }

  // Volunteers get the newsletter too, as they did on Mailchimp.
  const lists = list === 'volunteer' ? ['newsletter', 'volunteer'] : ['newsletter'];
  const { error } = await db.rpc('newsletter_subscribe', {
    p_email: email.trim().toLowerCase(),
    p_lists: lists,
    p_source: source.toLowerCase(),
    p_first_name: firstName ?? null,
    p_last_name: lastName ?? null,
  });
  if (error) {
    console.error(`[Mailing list] Could not add ${email}: ${error.message}`);
    return { outcome: 'unavailable', reason: 'db-error' };
  }

  console.info(`[Mailing list] ${email} joined ${list} via ${source}`);
  return { outcome: 'subscribed' };
}
