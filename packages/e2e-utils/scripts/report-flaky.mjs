#!/usr/bin/env node
// Summarise a Playwright JSON report (JSON_REPORT_FILE in src/config.ts) for
// GitHub Actions. A test that failed and then passed on a retry leaves the job
// green, so without this it goes unnoticed: each one gets a warning
// annotation, and the job summary gets a table of them with their errors.
//
//   node packages/e2e-utils/scripts/report-flaky.mjs <results.json> [suite name]
//
// Exits 0 whatever it finds: flaky tests are tracked, not failed. A missing
// report (the run never started) is reported and skipped.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const [file, suite = 'e2e'] = process.argv.slice(2);
if (!file) {
  console.error('usage: report-flaky.mjs <results.json> [suite name]');
  process.exit(2);
}

const summaryFile = process.env.GITHUB_STEP_SUMMARY;
const summary = (text) => {
  if (summaryFile) appendFileSync(summaryFile, `${text}\n`);
  else console.log(text);
};

if (!existsSync(file)) {
  summary(`### ${suite}: no Playwright report\n\nThe run produced no \`${file}\`.`);
  process.exit(0);
}

const report = JSON.parse(readFileSync(file, 'utf8'));
const flaky = [];

function walk(suiteNode, titles) {
  const path = suiteNode.title ? [...titles, suiteNode.title] : titles;
  for (const spec of suiteNode.specs ?? []) {
    for (const test of spec.tests ?? []) {
      if (test.status !== 'flaky') continue;
      const failed = (test.results ?? []).find((result) => result.status !== 'passed');
      flaky.push({
        title: [...path, spec.title].join(' › '),
        project: test.projectName,
        attempts: (test.results ?? []).length,
        error: (failed?.error?.message ?? '').split('\n')[0].replace(/\u001b\[[0-9;]*m/g, ''),
      });
    }
  }
  for (const child of suiteNode.suites ?? []) walk(child, path);
}
for (const top of report.suites ?? []) walk(top, []);

const { expected = 0, unexpected = 0, skipped = 0 } = report.stats ?? {};
const headline = `${expected} passed, ${flaky.length} flaky, ${unexpected} failed, ${skipped} skipped`;

if (flaky.length === 0) {
  summary(`### ${suite}: no flaky tests\n\n${headline}`);
  process.exit(0);
}

const escape = (text) => String(text).replace(/\|/g, '\\|');
summary(
  [
    `### ${suite}: ${flaky.length} flaky test${flaky.length === 1 ? '' : 's'}`,
    '',
    `${headline}. These failed at least once and passed on a retry; the traces are in the uploaded report.`,
    '',
    '| Test | Project | Attempts | First error |',
    '|---|---|---|---|',
    ...flaky.map(
      (t) => `| ${escape(t.title)} | ${t.project} | ${t.attempts} | ${escape(t.error || '—')} |`
    ),
  ].join('\n')
);

for (const t of flaky) {
  const message = `Flaky on ${t.project} (passed on attempt ${t.attempts}): ${t.title}. ${t.error}`;
  console.log(`::warning title=Flaky test (${suite})::${message.replace(/\r?\n/g, ' ')}`);
}
