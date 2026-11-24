import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, Resend } from 'resend';

// Keeps Resend's per-contact `unsubscribed` flag in step with the
// email_suppressions table (the source of truth, see ./suppression.ts).
// Broadcasts (the monthly newsletter) only check Resend's flag, and journeys
// only check our table, so the two must agree in both directions:
//   - suppressed with us, subscribed in Resend  -> mark unsubscribed in Resend
//   - unsubscribed in Resend, missing with us   -> add to email_suppressions
//     (a contact.updated webhook that never arrived)
//
// Used by the daily `resend-reconcile` cron job and by
// scripts/import-mailchimp-audience.mts, so it takes its clients as arguments
// and never reads import.meta.env.

/** Resend's default team rate limit is 2 requests per second; stay under it. */
export const RESEND_MIN_INTERVAL_MS = 550;

export type Pacer = () => Promise<void>;

/** Spaces calls at least `intervalMs` apart. */
export function createPacer(intervalMs = RESEND_MIN_INTERVAL_MS): Pacer {
  let next = 0;
  return async () => {
    const now = Date.now();
    const wait = next - now;
    next = Math.max(now, next) + intervalMs;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  };
}

interface ResendResult<T> {
  data: T | null;
  error: { name?: string; message: string } | null;
}

/** One paced Resend call, retried a few times when Resend says to slow down. */
export async function pacedCall<T>(
  pace: Pacer,
  call: () => Promise<ResendResult<T>>,
  attempts = 4
): Promise<ResendResult<T>> {
  let result: ResendResult<T> = { data: null, error: { message: 'not attempted' } };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await pace();
    result = await call();
    if (result.error?.name !== 'rate_limit_exceeded') return result;
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }
  return result;
}

export interface ContactPage {
  contacts: Contact[];
  /** Cursor for the page after this one; null when this was the last page. */
  next: string | null;
}

/** One page (up to 100) of contacts, account-wide or in one segment. */
export async function fetchContactPage(
  resend: Resend,
  pace: Pacer,
  { after, segmentId }: { after?: string | null; segmentId?: string }
): Promise<ContactPage> {
  const { data, error } = await pacedCall(pace, () =>
    resend.contacts.list({
      limit: 100,
      ...(after ? { after } : {}),
      ...(segmentId ? { segmentId } : {}),
    })
  );
  if (error || !data) {
    throw new Error(`Resend contact list failed: ${error?.message ?? 'no data'}`);
  }
  const contacts = data.data;
  const last = contacts.at(-1);
  return { contacts, next: data.has_more && last ? last.id : null };
}

/** Every contact, account-wide or in one segment. */
export async function fetchAllContacts(
  resend: Resend,
  pace: Pacer,
  segmentId?: string
): Promise<Contact[]> {
  const all: Contact[] = [];
  let after: string | null = null;
  do {
    const page: ContactPage = await fetchContactPage(resend, pace, { after, segmentId });
    all.push(...page.contacts);
    after = page.next;
  } while (after);
  return all;
}

/** Every suppressed address (lowercased), read 1,000 rows at a time. */
export async function loadSuppressedEmails(db: SupabaseClient): Promise<Set<string>> {
  const emails = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('email_suppressions')
      .select('email')
      .order('email')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read email_suppressions: ${error.message}`);
    for (const row of data ?? []) emails.add(String(row.email).toLowerCase());
    if (!data || data.length < PAGE) break;
  }
  return emails;
}

export interface ReconcileDeps {
  resend: Resend;
  pace: Pacer;
  /** Suppressed addresses, lowercased. Updated in place as new ones are added. */
  suppressed: Set<string>;
  /** Records an unsubscribe Resend knows about and we don't. */
  suppress: (email: string) => Promise<void>;
  dryRun: boolean;
}

export interface ReconcileTally {
  scanned: number;
  /** Suppressed with us, so marked unsubscribed in Resend. */
  markedUnsubscribed: string[];
  /** Unsubscribed in Resend, so added to email_suppressions. */
  newSuppressions: string[];
  errors: string[];
}

export function emptyTally(): ReconcileTally {
  return { scanned: 0, markedUnsubscribed: [], newSuppressions: [], errors: [] };
}

/** Brings one page of contacts into line with the suppression list. */
export async function reconcileContacts(
  contacts: Contact[],
  { resend, pace, suppressed, suppress, dryRun }: ReconcileDeps,
  tally: ReconcileTally
): Promise<void> {
  for (const contact of contacts) {
    tally.scanned++;
    const email = contact.email.toLowerCase();
    const isSuppressed = suppressed.has(email);

    if (isSuppressed && !contact.unsubscribed) {
      tally.markedUnsubscribed.push(email);
      if (dryRun) continue;
      const { error } = await pacedCall(pace, () =>
        resend.contacts.update({ id: contact.id, unsubscribed: true })
      );
      if (error) tally.errors.push(`mark ${email}: ${error.message}`);
    } else if (!isSuppressed && contact.unsubscribed) {
      tally.newSuppressions.push(email);
      if (dryRun) continue;
      try {
        await suppress(email);
        suppressed.add(email);
      } catch (e) {
        tally.errors.push(`suppress ${email}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}
