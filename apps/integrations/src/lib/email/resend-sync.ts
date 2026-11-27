import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, Resend } from 'resend';

// Paced Resend calls and bulk reads, shared by the newsletter send job and
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
