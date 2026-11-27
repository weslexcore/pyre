// One-off before the newsletter moves from Mailchimp to our own sending.
// Builds the mailing list (newsletter_subscribers) out of the Mailchimp
// audience and the Resend contacts made before the list moved to Supabase,
// brings email_suppressions up to date, and reports how many the first issue
// will reach.
//
//   A. Mailchimp unsubscribed / cleaned  -> email_suppressions
//      (source mailchimp-import; cleaned counts as a bounce). The Mailchimp
//      webhook only caught opt-outs after it was set up; this covers the rest.
//   B. Resend contacts marked unsubscribed that we never heard about
//      -> email_suppressions (source resend-import), and mirrored to Mailchimp
//      while Mailchimp still sends.
//   C. Mailchimp subscribers and subscribed Resend contacts
//      -> newsletter_subscribers (source mailchimp-import / resend-import).
//      An address already on the list is left as it is.
//
// Mailchimp pending, transactional and archived members are counted, not
// imported: none of them opted in to the newsletter. Suppressed addresses are
// imported to the list like anyone else; the send skips them.
//
// Idempotent: a second run finds nothing left to do.
//
// Run from apps/integrations. Needs MAILCHIMP_API_KEY, MAILCHIMP_AUDIENCE_ID,
// RESEND_API_KEY, SUPABASE_URL and SUPABASE_SECRET_KEY (or
// SUPABASE_SERVICE_ROLE_KEY) in .env or the shell:
//   tsx scripts/import-mailchimp-audience.mts            # dry run (default)
//   tsx scripts/import-mailchimp-audience.mts --execute  # make the changes

import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { createPacer, fetchAllContacts, loadSuppressedEmails } from '../src/lib/email/resend-sync';

try {
  process.loadEnvFile(new URL('../.env', import.meta.url).pathname);
} catch {
  // no .env file — rely on exported environment variables
}

const execute = process.argv.includes('--execute');
const env = (name: string) => process.env[name]?.trim() || undefined;

const MAILCHIMP_API_KEY = env('MAILCHIMP_API_KEY');
const MAILCHIMP_AUDIENCE_ID = env('MAILCHIMP_AUDIENCE_ID');
const RESEND_API_KEY = env('RESEND_API_KEY');
const SUPABASE_URL = env('SUPABASE_URL');
const SUPABASE_KEY = env('SUPABASE_SECRET_KEY') ?? env('SUPABASE_SERVICE_ROLE_KEY');

const missing = Object.entries({
  MAILCHIMP_API_KEY,
  MAILCHIMP_AUDIENCE_ID,
  RESEND_API_KEY,
  SUPABASE_URL,
  SUPABASE_SECRET_KEY: SUPABASE_KEY,
})
  .filter(([, value]) => !value)
  .map(([name]) => name);
if (missing.length > 0) {
  console.error(`Missing ${missing.join(', ')}`);
  process.exit(1);
}

const db = createClient(SUPABASE_URL!, SUPABASE_KEY!, { auth: { persistSession: false } });
const resend = new Resend(RESEND_API_KEY);
const pace = createPacer();

// --- Mailchimp ---

const mailchimpBase = `https://${MAILCHIMP_API_KEY!.split('-').pop()}.api.mailchimp.com/3.0`;
const mailchimpHeaders = {
  Authorization: `Basic ${Buffer.from(`anystring:${MAILCHIMP_API_KEY}`).toString('base64')}`,
  'Content-Type': 'application/json',
};

type MailchimpStatus =
  | 'subscribed'
  | 'unsubscribed'
  | 'cleaned'
  | 'pending'
  | 'transactional'
  | 'archived';

interface MailchimpMember {
  email: string;
  firstName?: string;
  lastName?: string;
}

async function mailchimpMembers(status: MailchimpStatus): Promise<MailchimpMember[]> {
  const members: MailchimpMember[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const url = new URL(`${mailchimpBase}/lists/${MAILCHIMP_AUDIENCE_ID}/members`);
    url.searchParams.set('status', status);
    url.searchParams.set('count', String(PAGE));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set(
      'fields',
      'total_items,members.email_address,members.merge_fields.FNAME,members.merge_fields.LNAME'
    );
    const response = await fetch(url, { headers: mailchimpHeaders });
    if (!response.ok) {
      throw new Error(`Mailchimp ${status} page failed (${response.status}): ${await response.text()}`);
    }
    const body = (await response.json()) as {
      total_items: number;
      members: { email_address: string; merge_fields?: { FNAME?: string; LNAME?: string } }[];
    };
    for (const m of body.members) {
      members.push({
        email: m.email_address.trim().toLowerCase(),
        firstName: m.merge_fields?.FNAME || undefined,
        lastName: m.merge_fields?.LNAME || undefined,
      });
    }
    if (body.members.length < PAGE || offset + PAGE >= body.total_items) break;
  }
  return members;
}

async function mailchimpUnsubscribe(email: string): Promise<void> {
  const hash = createHash('md5').update(email).digest('hex');
  const response = await fetch(`${mailchimpBase}/lists/${MAILCHIMP_AUDIENCE_ID}/members/${hash}`, {
    method: 'PATCH',
    headers: mailchimpHeaders,
    body: JSON.stringify({ status: 'unsubscribed' }),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Mailchimp unsubscribe failed (${response.status}) for ${email}`);
  }
}

// --- Supabase ---

async function insertSuppressions(
  rows: { email: string; reason: 'unsubscribe' | 'bounce'; source: string }[]
): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db
      .from('email_suppressions')
      .upsert(rows.slice(i, i + 500), { onConflict: 'email', ignoreDuplicates: true });
    if (error) throw new Error(`Suppression insert failed: ${error.message}`);
  }
}

interface SubscriberRow {
  email: string;
  first_name: string | null;
  last_name: string | null;
  source: string;
}

async function loadSubscriberEmails(): Promise<Set<string>> {
  const emails = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('newsletter_subscribers')
      .select('email')
      .order('email')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read newsletter_subscribers: ${error.message}`);
    for (const row of data ?? []) emails.add(String(row.email));
    if (!data || data.length < PAGE) break;
  }
  return emails;
}

// --- Run ---

const sample = (list: string[]) =>
  list.length === 0 ? '' : ` (e.g. ${list.slice(0, 5).join(', ')}${list.length > 5 ? ', …' : ''})`;

async function main() {
  console.log(execute ? 'EXECUTING — changes will be made.\n' : 'DRY RUN — nothing will change.\n');

  // Mailchimp audience by status.
  const statuses: MailchimpStatus[] = [
    'subscribed',
    'unsubscribed',
    'cleaned',
    'pending',
    'transactional',
    'archived',
  ];
  const byStatus = new Map<MailchimpStatus, MailchimpMember[]>();
  for (const status of statuses) byStatus.set(status, await mailchimpMembers(status));
  console.log('Mailchimp audience');
  for (const status of statuses) console.log(`  ${status.padEnd(13)} ${byStatus.get(status)!.length}`);

  const suppressed = await loadSuppressedEmails(db);
  console.log(`\nemail_suppressions before: ${suppressed.size}`);

  // A. Mailchimp opt-outs into the suppression list.
  const optOuts = new Map<string, 'unsubscribe' | 'bounce'>();
  for (const m of byStatus.get('unsubscribed')!) optOuts.set(m.email, 'unsubscribe');
  for (const m of byStatus.get('cleaned')!) if (!optOuts.has(m.email)) optOuts.set(m.email, 'bounce');
  const toSuppress = [...optOuts]
    .filter(([email]) => !suppressed.has(email))
    .map(([email, reason]) => ({ email, reason }));
  console.log(
    `\nA. Mailchimp opt-outs missing from email_suppressions: ${toSuppress.length}${sample(toSuppress.map((r) => r.email))}`
  );
  if (execute && toSuppress.length > 0) {
    await insertSuppressions(toSuppress.map((r) => ({ ...r, source: 'mailchimp-import' })));
  }
  for (const row of toSuppress) suppressed.add(row.email);

  // B. Resend contacts: unsubscribes we never heard about.
  console.log('\nReading Resend contacts…');
  const contacts = await fetchAllContacts(resend, pace);
  console.log(`Resend contacts: ${contacts.length}`);
  const errors: string[] = [];
  const resendOptOuts = contacts
    .filter((c) => c.unsubscribed && !suppressed.has(c.email.toLowerCase()))
    .map((c) => c.email.toLowerCase());
  console.log(
    `\nB. Unsubscribed in Resend but not suppressed: ${resendOptOuts.length}${sample(resendOptOuts)}`
  );
  for (const email of resendOptOuts) {
    if (execute) {
      try {
        await insertSuppressions([{ email, reason: 'unsubscribe', source: 'resend-import' }]);
        await mailchimpUnsubscribe(email);
      } catch (e) {
        errors.push(`suppress ${email}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
    }
    suppressed.add(email);
  }

  // C. The mailing list. Mailchimp first, so its names win over Resend's.
  const existing = await loadSubscriberEmails();
  console.log(`\nnewsletter_subscribers before: ${existing.size}`);
  const toAdd = new Map<string, SubscriberRow>();
  for (const m of byStatus.get('subscribed')!) {
    if (existing.has(m.email) || toAdd.has(m.email)) continue;
    toAdd.set(m.email, {
      email: m.email,
      first_name: m.firstName ?? null,
      last_name: m.lastName ?? null,
      source: 'mailchimp-import',
    });
  }
  for (const c of contacts) {
    const email = c.email.trim().toLowerCase();
    if (c.unsubscribed || existing.has(email) || toAdd.has(email)) continue;
    toAdd.set(email, {
      email,
      first_name: c.first_name || null,
      last_name: c.last_name || null,
      source: 'resend-import',
    });
  }
  const adding = [...toAdd.values()];
  const fromMailchimp = adding.filter((r) => r.source === 'mailchimp-import').length;
  console.log(
    `C. To add to the list: ${adding.length} (${fromMailchimp} from Mailchimp, ${adding.length - fromMailchimp} from Resend)${sample(adding.map((r) => r.email))}`
  );
  if (execute) {
    for (let i = 0; i < adding.length; i += 500) {
      const { error } = await db
        .from('newsletter_subscribers')
        .upsert(adding.slice(i, i + 500), { onConflict: 'email', ignoreDuplicates: true });
      if (error) errors.push(`subscribers ${i}-${i + 500}: ${error.message}`);
    }
  }

  const list = new Set([...existing, ...toAdd.keys()]);
  const reachable = [...list].filter((email) => !suppressed.has(email)).length;
  const mailchimpReachable = byStatus
    .get('subscribed')!
    .filter((m) => !suppressed.has(m.email)).length;

  console.log('\nSummary');
  console.log(`  email_suppressions after:              ${suppressed.size}`);
  console.log(`  Mailchimp subscribed, not suppressed:  ${mailchimpReachable}`);
  console.log(`  Mailing list after:                    ${list.size}`);
  console.log(`  The first issue will reach:            ${reachable}`);
  if (errors.length > 0) {
    console.log(`\n${errors.length} errors:`);
    for (const e of errors.slice(0, 50)) console.log(`  ${e}`);
    process.exitCode = 1;
  }
  if (!execute) console.log('\nDry run. Re-run with --execute to apply.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
