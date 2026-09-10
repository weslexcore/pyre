// A published session with no recognised type tag. Type is TAG-DRIVEN
// everywhere downstream (lib/momence-events.ts): an untagged session gets the
// generic confirmation email instead of the Open Hours / Social / Guided one,
// and the landing page cannot put it in a category.

import { type NormalizedSession, toRef } from '../feed';
import type { RuleDefinition, RuleFinding } from './rule';

/** The fallback type sessionTypeForTags() returns for unrecognised tags. */
const GENERAL = 'general';

export const untagged: RuleDefinition = {
  kind: 'untagged',
  title: 'Untagged sessions',
  description:
    'Published sessions with no session-type tag. They get the generic confirmation email and no category on the website.',
  builtIn: true,
  defaults: {},
  fields: [],
  run(sessions: NormalizedSession[]): RuleFinding[] {
    return sessions
      .filter((s) => s.isPublished && !s.isSpecialEvent && s.type === GENERAL)
      .sort((a, b) => a.start - b.start || a.id - b.id)
      .map((s) => ({
        rule: 'untagged',
        severity: 'fix',
        key: `untagged:${s.id}`,
        session: toRef(s),
        message:
          s.tags.length > 0
            ? `Tagged "${s.tags.join('", "')}", which is not a session type; guests get the generic confirmation`
            : 'No session tag; guests get the generic confirmation and the site has no category for it',
      }));
  },
};
