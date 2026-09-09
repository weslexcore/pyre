// The regular schedule is running out. The landing page tells guests the
// schedule is published about three weeks ahead; when the last published
// Open Hours or Social session is closer than that, whoever builds the
// stacks needs a nudge before guests find an empty calendar.
//
// One finding for the whole schedule, keyed on the last published day so it
// stays the same finding (and does not re-email) until the schedule is
// actually extended.

import { utcToEastern } from '@pyre/schedule-core';
import type { NormalizedSession } from '../feed';
import { formatDayLabel } from '../labels';
import { type Finding, PRESELECT_TYPES } from '../types';
import type { LintRule, RuleContext } from './rule';

/** Flag when the regular schedule ends within this many days. */
export const MIN_PUBLISHED_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export const horizonShort: LintRule = {
  name: 'horizon-short',
  run(sessions: NormalizedSession[], { now }: RuleContext): Finding[] {
    let last: NormalizedSession | null = null;
    for (const s of sessions) {
      if (!s.isPublished || s.isSpecialEvent || !PRESELECT_TYPES.includes(s.type)) continue;
      if (!last || s.start > last.start) last = s;
    }

    if (!last) {
      return [
        {
          rule: 'horizon-short',
          severity: 'notice',
          key: 'horizon-short:none',
          session: null,
          message: 'No Open Hours or Social sessions are published in the next four weeks',
        },
      ];
    }

    const cutoff = now.getTime() + MIN_PUBLISHED_DAYS * DAY_MS;
    if (last.start >= cutoff) return [];

    const lastIso = new Date(last.start).toISOString();
    return [
      {
        rule: 'horizon-short',
        severity: 'notice',
        key: `horizon-short:${utcToEastern(lastIso).date}`,
        session: null,
        message: `Open Hours and Social are published through ${formatDayLabel(lastIso)} only; the site promises about three weeks ahead`,
      },
    ];
  },
};
