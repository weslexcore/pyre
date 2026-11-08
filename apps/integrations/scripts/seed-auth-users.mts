// One-off seed: an auth.users row for every person on the staff table who
// has an email, linked through staff.user_id (see the staff_auth_users
// migration). Dashboard sign-in is Supabase Auth and invite-only, so the
// people already on the roster need their auth user created before they can
// ask for a sign-in link. /admin/users creates one for everyone added from
// now on; this covers the rows that predate it.
//
// Idempotent: a person who already has an auth user is linked, not
// duplicated, and a row already linked is left alone. Safe to re-run.
//
// Run (from apps/integrations, needs SUPABASE_URL + SUPABASE_SECRET_KEY (or
// SUPABASE_SERVICE_ROLE_KEY) in .env — the service key has auth admin rights):
//   tsx scripts/seed-auth-users.mts            # dry run (default)
//   tsx scripts/seed-auth-users.mts --execute  # create and link

import { createClient } from '@supabase/supabase-js';
import { ensureAuthUser, findAuthUserByEmail } from '../src/lib/auth/users';

// Load apps/integrations/.env if present (vars may also come from the shell).
try {
  process.loadEnvFile(new URL('../.env', import.meta.url).pathname);
} catch {
  // no .env file — rely on exported environment variables
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const execute = process.argv.includes('--execute');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface Row {
  id: string;
  email: string | null;
  display_name: string;
  is_admin: boolean;
  pages: string[];
  user_id: string | null;
}

const { data, error } = await db
  .from('staff')
  .select('id, email, display_name, is_admin, pages, user_id')
  .not('email', 'is', null)
  .order('display_name');
if (error) {
  console.error('staff read failed:', error.message);
  process.exit(1);
}

const rows = (data ?? []) as Row[];
console.log(`${rows.length} staff rows with an email (${execute ? 'EXECUTE' : 'dry run'})\n`);

let linked = 0;
let created = 0;
let failed = 0;
for (const row of rows) {
  const email = row.email as string;
  const access = row.is_admin ? 'admin' : row.pages.length > 0 ? `${row.pages.length} pages` : 'roster only';
  if (row.user_id) {
    console.log(`  = ${email.padEnd(36)} ${access.padEnd(12)} already linked (${row.user_id})`);
    continue;
  }

  if (!execute) {
    const existing = await findAuthUserByEmail(db, email);
    console.log(
      `  ~ ${email.padEnd(36)} ${access.padEnd(12)} would ${existing ? `link existing ${existing.id}` : 'create and link'}`
    );
    continue;
  }

  const result = await ensureAuthUser(db, { email, displayName: row.display_name });
  if (!result.ok) {
    failed++;
    console.log(`  ! ${email.padEnd(36)} ${access.padEnd(12)} FAILED: ${result.error}`);
    continue;
  }
  const { error: linkError } = await db
    .from('staff')
    .update({ user_id: result.userId })
    .eq('id', row.id);
  if (linkError) {
    failed++;
    console.log(`  ! ${email.padEnd(36)} ${access.padEnd(12)} user ${result.userId} but link FAILED: ${linkError.message}`);
    continue;
  }
  linked++;
  if (result.created) created++;
  console.log(
    `  + ${email.padEnd(36)} ${access.padEnd(12)} ${result.created ? 'created' : 'linked existing'} ${result.userId}`
  );
}

if (execute) {
  console.log(`\nlinked ${linked} (${created} new auth users), failed ${failed}`);
  if (failed > 0) process.exit(1);
} else {
  console.log('\nDry run — re-run with --execute to create and link.');
}
