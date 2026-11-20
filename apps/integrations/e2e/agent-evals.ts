// Runs every pyre-agents eval (apps/agents/evals) against a local stack, the
// same way in CI (.github/workflows/evals.yml) and on a laptop:
//
//   AI_GATEWAY_API_KEY=… yarn workspace @pyre/integrations test:agent-evals [eve eval args…]
//
// 1. Starts (or reuses) this suite's e2e Supabase stack (553xx, every
//    migration replayed; see e2e/supabase.ts). Never the developer's stack,
//    never staging or production.
// 2. Seeds next week's shifts, so the scheduler evals have a week to draft
//    (the migrations only carry the summer's imported schedule).
// 3. Starts the mock upstreams and this app under `astro dev`, with the
//    Playwright suite's environment (e2e/env.ts): every external service is
//    the mock or blank. The agents' save_proposal / save_suggestions calls
//    land on this app's /api/agent/* routes, which validate them for real.
// 4. Runs `eve eval --strict` in apps/agents with AGENT_FORCE_DRY_RUN=1, so
//    nothing an agent proposes is written. Model and judge calls are the only
//    traffic that leaves the machine (AI Gateway, AI_GATEWAY_API_KEY).
//
// Extra arguments go to `eve eval` (e.g. an eval id, `--tag`, `--verbose`).
// Server logs land in test-results/agent-evals/.

import { type ChildProcess, spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Off the Playwright suite's ports (4339/4340), so both can run side by side
// against the one Supabase stack. Set before e2e/env loads: it reads them.
process.env.E2E_APP_PORT ||= '4349';
process.env.E2E_MOCK_PORT ||= '4350';

const { addDays, utcToEastern, weekStartOf } = await import('@pyre/schedule-core');
const { createClient } = await import('@supabase/supabase-js');
const { AGENT_API_SECRET, EVE_CHANNEL_SECRET } = await import('./agent-secrets');
const { APP_ENV, APP_URL, MOCK_URL, SUPABASE } = await import('./env');

const APP_DIR = fileURLToPath(new URL('..', import.meta.url));
const AGENTS_DIR = fileURLToPath(new URL('../../agents', import.meta.url));
const LOG_DIR = fileURLToPath(new URL('../test-results/agent-evals', import.meta.url));

const FIXTURE_NOTE = 'agent-evals fixture';

if (!process.env.AI_GATEWAY_API_KEY) {
  console.error('AI_GATEWAY_API_KEY is not set: the evals call live models through AI Gateway.');
  process.exit(2);
}

/** Next week's shifts (Monday to Sunday, Eastern), replacing any a previous run left. */
async function seedNextWeek(): Promise<string> {
  const db = createClient(SUPABASE.apiUrl, SUPABASE.serviceRoleKey, {
    auth: { persistSession: false },
  });
  const today = utcToEastern(new Date().toISOString()).date;
  const monday = addDays(weekStartOf(today), 7);

  const { error: clearError } = await db
    .from('shifts')
    .delete()
    .eq('notes', FIXTURE_NOTE)
    .gte('shift_date', addDays(monday, -28));
  if (clearError) throw new Error(`clear fixture shifts: ${clearError.message}`);

  // Open evenings Wednesday to Friday, a long day on Saturday and Sunday: the
  // shape of a normal week, two people a shift.
  const shifts = [
    { day: 2, label: 'Evening', starts_at: '14:30', ends_at: '20:30' },
    { day: 3, label: 'Evening', starts_at: '14:30', ends_at: '20:30' },
    { day: 4, label: 'Evening', starts_at: '14:30', ends_at: '21:30' },
    { day: 5, label: 'Morning', starts_at: '09:00', ends_at: '13:00' },
    { day: 5, label: 'Afternoon', starts_at: '13:00', ends_at: '19:30' },
    { day: 6, label: 'Day', starts_at: '10:00', ends_at: '17:00' },
  ].map(({ day, ...shift }) => ({
    ...shift,
    shift_date: addDays(monday, day),
    staff_needed: 2,
    source: 'manual',
    notes: FIXTURE_NOTE,
  }));
  const { error } = await db.from('shifts').insert(shifts);
  if (error) throw new Error(`seed fixture shifts: ${error.message}`);
  return monday;
}

const children: ChildProcess[] = [];

function startServer(name: string, command: string, args: string[], env: Record<string, string>) {
  const log = createWriteStream(`${LOG_DIR}/${name}.log`);
  const child = spawn(command, args, {
    cwd: APP_DIR,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  child.on('exit', (code) => {
    if (!shuttingDown) console.error(`${name} exited early (${code}); see ${LOG_DIR}/${name}.log`);
  });
  children.push(child);
}

async function waitFor(name: string, url: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${name} did not come up at ${url} within ${timeoutMs / 1000}s`);
}

let shuttingDown = false;
function stopServers(): void {
  shuttingDown = true;
  for (const child of children) {
    if (child.pid && child.exitCode === null) {
      try {
        // The whole group: yarn -> astro / tsx.
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
  }
}
process.on('exit', stopServers);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopServers();
    process.exit(130);
  });
}

async function main(): Promise<number> {
  mkdirSync(LOG_DIR, { recursive: true });

  const monday = await seedNextWeek();
  console.log(`Seeded fixture shifts for the week of ${monday}.`);

  startServer('mock-upstreams', 'yarn', ['tsx', 'e2e/mock-server/server.ts'], {
    SUPABASE_URL: APP_ENV.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: APP_ENV.SUPABASE_SERVICE_ROLE_KEY,
  });
  startServer(
    'integrations',
    'yarn',
    ['astro', 'dev', '--ignore-lock', '--port', String(new URL(APP_URL).port), '--host', 'localhost'],
    APP_ENV
  );
  await waitFor('mock upstreams', `${MOCK_URL}/__health`);
  await waitFor('integrations', APP_URL);
  console.log(`Integrations on ${APP_URL}, mock upstreams on ${MOCK_URL}.`);

  // `eve eval` boots its own `eve dev` with this environment. Every variable
  // the agents read is set here, so a developer's apps/agents .env can't
  // point the run anywhere else.
  const agentEnv: Record<string, string> = {
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY as string,
    SUPABASE_URL: SUPABASE.apiUrl,
    // The local stack rejects sb_secret_* keys; the service-role JWT stands in.
    SUPABASE_AGENTS_SECRET_KEY: SUPABASE.serviceRoleKey,
    INTEGRATIONS_BASE_URL: APP_URL,
    INTEGRATIONS_PROTECTION_BYPASS: '',
    AGENT_API_SECRET,
    EVE_CHANNEL_SECRET,
    AGENT_FORCE_DRY_RUN: '1',
    KNOWLEDGE_SITE_URL: APP_URL,
  };

  const args = ['eval', '--strict', '--junit', '.eve/junit.xml', ...process.argv.slice(2)];
  const evalRun = spawn('yarn', args, {
    cwd: AGENTS_DIR,
    env: { ...process.env, ...agentEnv },
    stdio: 'inherit',
  });
  return new Promise((resolve) => evalRun.on('exit', (code) => resolve(code ?? 1)));
}

main()
  .then((code) => {
    stopServers();
    process.exit(code);
  })
  .catch((error) => {
    console.error(error);
    stopServers();
    process.exit(1);
  });
