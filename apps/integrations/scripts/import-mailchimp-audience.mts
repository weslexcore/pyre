// One-off before the newsletter moves from Mailchimp to Resend broadcasts.
// Brings the Mailchimp audience, email_suppressions and the Resend contact list
// into agreement, then reports what the broadcast segment will reach.
//
//   A. Mailchimp unsubscribed / cleaned  -> email_suppressions
//      (source mailchimp-import; cleaned counts as a bounce). The Mailchimp
//      webhook only caught opt-outs after it was set up; this covers the rest.
//   B. Every Resend contact reconciled with email_suppressions, both ways
//      (lib/email/resend-sync.ts): suppressed -> unsubscribed in Resend;
//      unsubscribed in Resend but unknown to us -> suppressed, and mirrored to
//      Mailchimp while Mailchimp still sends.
//   C. Mailchimp subscribers with no Resend contact -> created in the segment
//      (people who signed up through Mailchimp and never booked).
//   D. Subscribed, unsuppressed Resend contacts outside the segment -> added
//      (contacts created before RESEND_SEGMENT_ID was set).
//
// Mailchimp pending, transactional and archived members are counted, not
// imported: none of them opted in to the newsletter.
//
// Idempotent: a second run finds nothing left to do. Resend is paced at ~2
// requests a second, so a large audience takes a few minutes.
//
// Run from apps/integrations. Needs MAILCHIMP_API_KEY, MAILCHIMP_AUDIENCE_ID,
// RESEND_API_KEY, RESEND_SEGMENT_ID, SUPABASE_URL and SUPABASE_SECRET_KEY (or
// SUPABASE_SERVICE_ROLE_KEY) in .env or the shell:
//   tsx scripts/import-mailchimp-audience.mts            # dry run (default)
//   tsx scripts/import-mailchimp-audience.mts --execute  # make the changes

import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { type Contact, Resend } from 'resend';
import {
  createPacer,
  emptyTally,
  fetchAllContacts,
  loadSuppressedEmails,
  pacedCall,
  reconcileContacts,
} from '../src/lib/email/resend-sync';

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
const SEGMENT_ID = env('RESEND_SEGMENT_ID');
const SUPABASE_URL = env('SUPABASE_URL');
const SUPABASE_KEY = env('SUPABASE_SECRET_KEY') ?? env('SUPABASE_SERVICE_ROLE_KEY');

const missing = Object.entries({
  MAILCHIMP_API_KEY,
  MAILCHIMP_AUDIENCE_ID,
  RESEND_API_KEY,
  RESEND_SEGMENT_ID: SEGMENT_ID,
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

  // B. Resend contacts against the suppression list.
  console.log('\nReading Resend contacts…');
  const contacts = await fetchAllContacts(resend, pace);
  const segmentIds = new Set((await fetchAllContacts(resend, pace, SEGMENT_ID)).map((c) => c.id));
  console.log(`Resend contacts: ${contacts.length} (in segment: ${segmentIds.size})`);

  const tally = emptyTally();
  await reconcileContacts(
    contacts,
    {
      resend,
      pace,
      suppressed,
      dryRun: !execute,
      suppress: async (email) => {
        await insertSuppressions([{ email, reason: 'unsubscribe', source: 'resend-reconcile' }]);
        await mailchimpUnsubscribe(email);
      },
    },
    tally
  );
  if (!execute) for (const email of tally.newSuppressions) suppressed.add(email);
  console.log(
    `\nB. Suppressed but subscribed in Resend, marked unsubscribed: ${tally.markedUnsubscribed.length}${sample(tally.markedUnsubscribed)}`
  );
  console.log(
    `   Unsubscribed in Resend but not suppressed, now suppressed: ${tally.newSuppressions.length}${sample(tally.newSuppressions)}`
  );

  // The contacts as they stand after B.
  const byEmail = new Map<string, Contact>();
  for (const c of contacts) {
    const email = c.email.toLowerCase();
    byEmail.set(email, { ...c, unsubscribed: c.unsubscribed || suppressed.has(email) });
  }

  // C. Mailchimp subscribers Resend doesn't have.
  const toCreate = byStatus
    .get('subscribed')!
    .filter((m) => !byEmail.has(m.email) && !suppressed.has(m.email));
  console.log(
    `\nC. Mailchimp subscribers with no Resend contact, to create: ${toCreate.length}${sample(toCreate.map((m) => m.email))}`
  );
  let created = 0;
  for (const m of toCreate) {
    if (!execute) continue;
    const { error } = await pacedCall(pace, () =>
      resend.contacts.create({
        email: m.email,
        firstName: m.firstName,
        lastName: m.lastName,
        segments: [{ id: SEGMENT_ID! }],
      })
    );
    if (error) tally.errors.push(`create ${m.email}: ${error.message}`);
    else created++;
  }

  // D. Subscribed contacts outside the segment.
  const toAdd = [...byEmail.values()].filter((c) => !c.unsubscribed && !segmentIds.has(c.id));
  console.log(
    `\nD. Subscribed contacts not in the segment, to add: ${toAdd.length}${sample(toAdd.map((c) => c.email))}`
  );
  let added = 0;
  for (const c of toAdd) {
    if (!execute) continue;
    const { error } = await pacedCall(pace, () =>
      resend.contacts.segments.add({ contactId: c.id, segmentId: SEGMENT_ID! })
    );
    if (error) tally.errors.push(`segment ${c.email}: ${error.message}`);
    else added++;
  }

  // What a broadcast to the segment will reach. Resend skips unsubscribed
  // contacts itself, so this counts the subscribed ones.
  const reachable =
    [...byEmail.values()].filter((c) => !c.unsubscribed).length + toCreate.length;
  const mailchimpReachable = byStatus
    .get('subscribed')!
    .filter((m) => !suppressed.has(m.email)).length;

  console.log('\nSummary');
  console.log(`  email_suppressions after:              ${suppressed.size}`);
  console.log(`  Mailchimp subscribed, not suppressed:  ${mailchimpReachable}`);
  console.log(`  Newsletter segment will reach:         ${reachable}`);
  if (execute) console.log(`  Created ${created}, added to segment ${added}`);
  if (tally.errors.length > 0) {
    console.log(`\n${tally.errors.length} errors:`);
    for (const e of tally.errors.slice(0, 50)) console.log(`  ${e}`);
    process.exitCode = 1;
  }
  if (!execute) console.log('\nDry run. Re-run with --execute to apply.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
