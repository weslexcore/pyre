// A session still in draft with its start close enough that it was almost
// certainly meant to be live by now. Momence shows drafts to staff only, so
// nothing reminds anyone to press publish.

import { type NormalizedSession, toRef } from '../feed';
import { formatDayLabel } from '../labels';
import type { RuleContext, RuleDefinition, RuleFinding } from './rule';

/** A draft starting within this many days is flagged. */
export const DRAFT_SOON_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DraftSoonParams extends Record<string, unknown> {
  days: number;
}

export const draftSoon: RuleDefinition<DraftSoonParams> = {
  kind: 'draft-soon',
  title: 'Drafts starting soon',
  description: 'Sessions still in draft that start within the next few days.',
  builtIn: true,
  defaults: { days: DRAFT_SOON_DAYS },
  fields: [
    { key: 'days', label: 'Flag drafts starting within (days)', type: 'number', min: 1, max: 60 },
  ],
  run(sessions: NormalizedSession[], { now }: RuleContext, { days }): RuleFinding[] {
    const cutoff = now.getTime() + days * DAY_MS;
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
