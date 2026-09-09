// A session still in draft with its start close enough that it was almost
// certainly meant to be live by now. Momence shows drafts to staff only, so
// nothing reminds anyone to press publish.

import { type NormalizedSession, toRef } from '../feed';
import { formatDayLabel } from '../labels';
import type { Finding } from '../types';
import type { LintRule, RuleContext } from './rule';

/** A draft starting within this many days is flagged. */
export const DRAFT_SOON_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export const draftSoon: LintRule = {
  name: 'draft-soon',
  run(sessions: NormalizedSession[], { now }: RuleContext): Finding[] {
    const cutoff = now.getTime() + DRAFT_SOON_DAYS * DAY_MS;
    return sessions
      .filter((s) => !s.isPublished && s.start < cutoff)
      .sort((a, b) => a.start - b.start || a.id - b.id)
      .map((s) => ({
        rule: 'draft-soon',
        severity: 'fix',
        key: `draft:${s.id}`,
        session: toRef(s),
        message: `Still a draft and starts ${formatDayLabel(new Date(s.start).toISOString())}; publish it or delete it`,
      }));
  },
};
