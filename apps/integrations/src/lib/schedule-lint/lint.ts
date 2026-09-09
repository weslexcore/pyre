// The schedule lint, as a pure function: feed in, report out. The job and
// the tests both call this; only the job touches the clock, Redis, and email.

import { createHash } from 'node:crypto';
import type { MomenceEvent } from '@/lib/momence-events';
import { type FeedWindow, horizonOf, normalizeFeed } from './feed';
import { RULES } from './rules';
import type { Finding, LintReport, Severity } from './types';

const SEVERITY_ORDER: Record<Severity, number> = { cancel: 0, fix: 1, notice: 2 };

/**
 * Twelve hex characters of the sorted finding keys. Two runs that found the
 * same problems produce the same digest whatever order the feed came in,
 * which is what lets the send log tell "still the same list" from "new".
 */
export function digestOf(findings: Pick<Finding, 'key'>[]): string {
  const keys = [...new Set(findings.map((f) => f.key))].sort();
  return createHash('sha1').update(keys.join('\n')).digest('hex').slice(0, 12);
}

export function runLint(events: MomenceEvent[], window: FeedWindow): LintReport {
  const sessions = normalizeFeed(events, window);
  const horizon = horizonOf(window);
  const ctx = { now: window.now, horizon };

  const findings: Finding[] = [];
  for (const rule of RULES) findings.push(...rule.run(sessions, ctx));

  findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      Date.parse(a.session?.startsAt ?? a.context?.startsAt ?? '') -
        Date.parse(b.session?.startsAt ?? b.context?.startsAt ?? '') ||
      a.key.localeCompare(b.key)
  );

  return {
    horizonStart: horizon.start,
    horizonEnd: horizon.end,
    findings,
    digest: digestOf(findings),
  };
}

/** Findings per rule and per severity, for the tick summary. */
export function countFindings(findings: Finding[]): {
  byRule: Record<string, number>;
  bySeverity: Record<Severity, number>;
} {
  const byRule: Record<string, number> = {};
  const bySeverity: Record<Severity, number> = { cancel: 0, fix: 0, notice: 0 };
  for (const f of findings) {
    byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
    bySeverity[f.severity] += 1;
  }
  return { byRule, bySeverity };
}
