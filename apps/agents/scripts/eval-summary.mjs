// Markdown table of an `eve eval --junit` report, for the GitHub job summary
// (.github/workflows/evals.yml). Never fails the job: a missing or unreadable
// report prints a note instead.
//
//   node apps/agents/scripts/eval-summary.mjs apps/agents/.eve/junit.xml

import { existsSync, readFileSync } from 'node:fs';

const path = process.argv[2];
console.log('## Agent evals\n');

if (!path || !existsSync(path)) {
  console.log('No JUnit report was written; see the step log and the `agent-evals` artifact.');
  process.exit(0);
}

const xml = readFileSync(path, 'utf8');
const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&');
const attr = (tag, name) => {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? decode(match[1]) : '';
};

const rows = [];
for (const match of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
  const [, attrs, , body = ''] = match;
  const failure = body.match(/<(failure|error)\b([^>]*)>?/);
  const status = failure ? 'failed' : /<skipped\b/.test(body) ? 'skipped' : 'passed';
  const message = failure ? attr(failure[2], 'message').split('\n')[0].slice(0, 200) : '';
  const time = attr(`<x ${attrs}>`, 'time');
  const seconds = time === '' ? Number.NaN : Number(time);
  rows.push({ name: attr(`<x ${attrs}>`, 'name'), status, message, seconds });
}

if (rows.length === 0) {
  console.log('The report lists no evals.');
  process.exit(0);
}

const count = (status) => rows.filter((r) => r.status === status).length;
console.log(`${count('passed')} passed, ${count('failed')} failed, ${count('skipped')} skipped.\n`);
console.log('| Eval | Result | Time | Detail |');
console.log('| --- | --- | --- | --- |');
const icon = { passed: '✅', failed: '❌', skipped: '⏭️' };
for (const row of rows.sort((a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name))) {
  const time = Number.isFinite(row.seconds) ? `${row.seconds.toFixed(1)}s` : '';
  const detail = row.message.replace(/\|/g, '\\|');
  console.log(`| \`${row.name}\` | ${icon[row.status]} ${row.status} | ${time} | ${detail} |`);
}
