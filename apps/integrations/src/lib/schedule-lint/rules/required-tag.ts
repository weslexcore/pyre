// Custom rule: a session whose title says one thing must carry the matching
// tag. Titles are what staff type; tags are what every system reads. "Social
// Evening" without the Social tag books as a generic session and confirms
// with the wrong email.

import { type NormalizedSession, norm, toRef } from '../feed';
import type { RuleDefinition, RuleFinding } from './rule';

export interface RequiredTagParams extends Record<string, unknown> {
  /** Case-insensitive substring of the title. */
  titleContains: string;
  /** The tag such a session must carry, case-insensitive. */
  tag: string;
}

export const requiredTag: RuleDefinition<RequiredTagParams> = {
  kind: 'required-tag',
  title: 'Required tag',
  description: 'Sessions whose title contains a phrase must carry a given tag.',
  builtIn: false,
  defaults: { titleContains: 'Social', tag: 'Social' },
  fields: [
    { key: 'titleContains', label: 'When the title contains', type: 'text' },
    { key: 'tag', label: 'It must be tagged', type: 'text' },
  ],
  run(sessions: NormalizedSession[], _ctx, { titleContains, tag }): RuleFinding[] {
    const needle = norm(titleContains);
    const wanted = norm(tag);
    if (!needle || !wanted) return [];
    return sessions
      .filter(
        (s) =>
          s.isPublished && norm(s.title).includes(needle) && !s.tags.some((t) => norm(t) === wanted)
      )
      .sort((a, b) => a.start - b.start || a.id - b.id)
      .map((s) => ({
        rule: 'required-tag',
        severity: 'fix',
        key: `tag:${s.id}:${wanted}`,
        session: toRef(s),
        message: `Title says "${titleContains}" but the session is not tagged ${tag}`,
      }));
  },
};
