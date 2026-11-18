// A local Supabase stack for E2E suites, separate from the developer's own.
//
// `ensureLocalSupabase` builds a Supabase CLI workdir at apps/supabase/.e2e
// from the real one: config.toml (with its own project id, ports and the app's
// origin), migrations and email templates. Then it makes sure that stack is
// running and fully migrated. apps/supabase stays the only source: `.e2e` is
// rebuilt from it on every run, so a new migration reaches the tests without
// anyone syncing anything.
//
// The developer's `pyre` stack (ports 543xx) is never touched: tests create
// auth users and rows on every run, and a wipe to start clean would take the
// developer's data with it. The e2e stack defaults to ports 553xx.
//
// It runs when a suite's playwright.config.ts loads, before any webServer,
// because the app's webServer env needs the stack's keys. Playwright loads the
// config again in every worker, so the result is cached in process.env, which
// workers inherit.

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export interface LocalSupabaseOptions {
  /** Absolute path to apps/supabase (the directory holding config.toml). */
  supabaseDir: string;
  /** Origin of the app under test, e.g. http://localhost:4339. Auth redirects and passkeys allow it. */
  appOrigin: string;
  /** Docker project id. Defaults to `pyre-e2e`. */
  projectId?: string;
  /** Replaces the `543` prefix of every port. Defaults to `553` (API on 55321). */
  portPrefix?: string;
}

export interface LocalSupabase {
  projectId: string;
  /** http://127.0.0.1:<port>: REST, Auth, Storage and Realtime. */
  apiUrl: string;
  /** Legacy anon JWT (the publishable-key role). */
  anonKey: string;
  /** Legacy service-role JWT. The local stack rejects the sb_secret_* form. */
  serviceRoleKey: string;
  /** postgres:// URL for direct SQL. */
  dbUrl: string;
  /** Mailpit (the local mail catcher): its web UI and /api/v1. */
  mailpitUrl: string;
}

const CACHE_ENV = 'E2E_SUPABASE';

// Services no suite needs. Leaving them out makes a cold start quicker and
// lighter. Auth, REST, Realtime, Storage and Mailpit stay.
const EXCLUDED_SERVICES = [
  'studio',
  'imgproxy',
  'edge-runtime',
  'logflare',
  'vector',
  'supavisor',
  'postgres-meta',
];

// Local replays of the migrations create tables without the grants Supabase
// gives them in production, so every PostgREST read fails with 42501. Grant
// what production has, now and for tables a later migration creates.
const GRANTS_SQL = `
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

/** The CLI from apps/supabase's devDependency, as [command, ...leading args]. */
function supabaseBin(supabaseDir: string): string[] {
  const require = createRequire(join(supabaseDir, 'package.json'));
  const pkgPath = require.resolve('supabase/package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin: string | Record<string, string> };
  const entry = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.supabase;
  const path = join(pkgPath, '..', entry);
  // Recent releases ship a Node launcher; older ones a native binary.
  return path.endsWith('.js') ? [process.execPath, path] : [path];
}

/**
 * The e2e copy of config.toml: its own project id and ports, the app's origin
 * in place of the developer's dev server, and no remote overrides.
 */
export function e2eConfigToml(source: string, options: Required<Omit<LocalSupabaseOptions, 'supabaseDir'>>): string {
  const { projectId, portPrefix, appOrigin } = options;
  const appHost = new URL(appOrigin).host;
  let config = source.split(/^\[remotes\./m)[0];
  config = config
    .replace(/^project_id\s*=.*$/m, `project_id = "${projectId}"`)
    .replace(/\b543(\d\d)\b/g, `${portPrefix}$1`)
    .replace(/localhost:4321/g, appHost);
  // Mailpit's SMTP and POP3 ports sit beside its web port; move them too so
  // they can't collide with the developer's stack.
  config = config.replace(
    /^\[local_smtp\]\n/m,
    `[local_smtp]\nsmtp_port = ${portPrefix}25\npop3_port = ${portPrefix}26\n`
  );
  // A suite sends far more sign-in emails than a person does: several per
  // run, some to one address seconds apart. Auth's defaults (two emails an
  // hour, one per address per minute) would refuse them with a 429.
  config = config.replace(/^\[auth\.email\]\n/m, '[auth.email]\nmax_frequency = "1s"\n');
  config += `
# Added for E2E (packages/e2e-utils src/supabase.ts): no Auth rate limits.
[auth.rate_limit]
email_sent = 10000
sms_sent = 10000
token_refresh = 10000
token_verifications = 10000
sign_in_sign_ups = 10000
anonymous_users = 10000
web3 = 10000
`;
  return config;
}

/**
 * Write the workdir. Returns whether config.toml differs from the one the
 * stack was last started with: the containers read it at start, so a running
 * stack must restart to pick up a change.
 */
function writeWorkdir(options: Required<LocalSupabaseOptions>): { workdir: string; configChanged: boolean } {
  const workdir = join(options.supabaseDir, '.e2e');
  const target = join(workdir, 'supabase');
  mkdirSync(target, { recursive: true });

  const source = readFileSync(join(options.supabaseDir, 'config.toml'), 'utf8');
  const config = e2eConfigToml(source, options);
  const configPath = join(target, 'config.toml');
  const configChanged = !existsSync(configPath) || readFileSync(configPath, 'utf8') !== config;
  writeFileSync(configPath, config);

  // Replace (not merge) the copies, so a renamed or deleted migration is gone
  // here too. The CLI's own state (.temp, .branches) is left alone.
  for (const dir of ['migrations', 'templates']) {
    rmSync(join(target, dir), { recursive: true, force: true });
    if (existsSync(join(options.supabaseDir, dir))) {
      cpSync(join(options.supabaseDir, dir), join(target, dir), { recursive: true });
    }
  }
  return { workdir, configChanged };
}

interface StatusJson {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
  DB_URL: string;
  INBUCKET_URL?: string;
  MAILPIT_URL?: string;
}

function readStatus(bin: string[], workdir: string): StatusJson | null {
  const [command, ...lead] = bin;
  const result = spawnSync(command, [...lead, 'status', '--workdir', workdir, '-o', 'json'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  // The CLI prints notices ("Stopped services: …") on stderr and JSON on stdout.
  const start = result.stdout.indexOf('{');
  if (start < 0) return null;
  try {
    const status = JSON.parse(result.stdout.slice(start)) as StatusJson;
    return status.API_URL ? status : null;
  } catch {
    return null;
  }
}

function run(bin: string[], args: string[]): void {
  const [command, ...lead] = bin;
  execFileSync(command, [...lead, ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
}

function applyGrants(projectId: string): void {
  execFileSync(
    'docker',
    ['exec', '-i', `supabase_db_${projectId}`, 'psql', '-U', 'postgres', '-d', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1'],
    { input: GRANTS_SQL, stdio: ['pipe', 'ignore', 'inherit'] }
  );
}

const start = (bin: string[], workdir: string) =>
  run(bin, ['start', '--workdir', workdir, '-x', EXCLUDED_SERVICES.join(',')]);

/**
 * Throw the stack's database away and start it fresh: every migration replays
 * on an empty database, as on a CI runner. Used instead of `supabase db reset`,
 * whose stricter config check rejects keys `start` accepts (e.g.
 * auth.email.minimum_password_length as of CLI 2.111).
 */
function rebuild(bin: string[], workdir: string): void {
  run(bin, ['stop', '--no-backup', '--workdir', workdir]);
  start(bin, workdir);
}

function resolveOptions(options: LocalSupabaseOptions): Required<LocalSupabaseOptions> {
  return { projectId: 'pyre-e2e', portPrefix: '553', ...options };
}

/**
 * Start (or reuse) the e2e stack, bring it up to date with apps/supabase's
 * migrations, and return its URLs and keys. Needs Docker.
 */
export function ensureLocalSupabase(options: LocalSupabaseOptions): LocalSupabase {
  const cached = process.env[CACHE_ENV];
  if (cached) return JSON.parse(cached) as LocalSupabase;

  const resolved = resolveOptions(options);
  const bin = supabaseBin(resolved.supabaseDir);
  const { workdir, configChanged } = writeWorkdir(resolved);

  if (configChanged && readStatus(bin, workdir)) {
    console.log(`[e2e] config.toml changed; restarting Supabase stack ${resolved.projectId}`);
    run(bin, ['stop', '--workdir', workdir]);
  }

  if (readStatus(bin, workdir)) {
    console.log(`[e2e] Supabase stack ${resolved.projectId} is running; applying new migrations`);
    try {
      run(bin, ['migration', 'up', '--local', '--workdir', workdir]);
    } catch {
      // Usually a migration that was renamed (a timestamp bump) or deleted
      // after this stack applied it. Rebuild from scratch.
      console.log('[e2e] Migrations no longer match; rebuilding the e2e database');
      rebuild(bin, workdir);
    }
  } else {
    console.log(`[e2e] Starting Supabase stack ${resolved.projectId} (first run pulls images)`);
    start(bin, workdir);
  }
  applyGrants(resolved.projectId);

  const status = readStatus(bin, workdir);
  if (!status) throw new Error(`Supabase stack ${resolved.projectId} did not report its status`);

  const stack: LocalSupabase = {
    projectId: resolved.projectId,
    apiUrl: status.API_URL,
    anonKey: status.ANON_KEY,
    serviceRoleKey: status.SERVICE_ROLE_KEY,
    dbUrl: status.DB_URL,
    mailpitUrl: status.MAILPIT_URL ?? status.INBUCKET_URL ?? '',
  };
  process.env[CACHE_ENV] = JSON.stringify(stack);
  return stack;
}

/**
 * Wipe the e2e database and replay every migration (a local escape hatch).
 * Only this stack's data goes; the developer's own stack is a different
 * project.
 */
export function resetLocalSupabase(options: LocalSupabaseOptions): void {
  const resolved = resolveOptions(options);
  const bin = supabaseBin(resolved.supabaseDir);
  const { workdir } = writeWorkdir(resolved);
  rebuild(bin, workdir);
  applyGrants(resolved.projectId);
  delete process.env[CACHE_ENV];
}

/** Stop the e2e stack's containers (data volumes are kept). */
export function stopLocalSupabase(options: LocalSupabaseOptions): void {
  const resolved = resolveOptions(options);
  const bin = supabaseBin(resolved.supabaseDir);
  const { workdir } = writeWorkdir(resolved);
  run(bin, ['stop', '--workdir', workdir]);
  delete process.env[CACHE_ENV];
}
