// The report as the email describes it: overlap findings grouped under their
// special event, everything else as one line each, counts for the subject.

import type {
  ScheduleLintLine,
  ScheduleLintOverlapGroup,
  ScheduleLintProps,
  ScheduleLintSession,
} from '@/emails/types';
import { bookingLabel, formatShortDate, formatWhenLabel, typeLabel } from './labels';
import type { Finding, LintReport, SessionRef } from './types';

function toLine(session: SessionRef): ScheduleLintSession {
  return {
    title: session.title,
    whenLabel: formatWhenLabel(session.startsAt, session.endsAt),
    typeLabel: typeLabel(session.type),
    bookingLabel: bookingLabel(session),
    ...(session.link && { link: session.link }),
  };
}

function overlapGroups(findings: Finding[]): ScheduleLintOverlapGroup[] {
  const groups = new Map<number, ScheduleLintOverlapGroup>();
  for (const f of findings) {
    if (f.rule !== 'special-event-overlap' || !f.session || !f.context) continue;
    const special = f.context;
    let group = groups.get(special.id);
    if (!group) {
      group = {
        eventTitle: special.title,
        whenLabel: formatWhenLabel(special.startsAt, special.endsAt),
        ...(special.location && { location: special.location }),
        ...(special.link && { link: special.link }),
        sessions: [],
      };
      groups.set(special.id, group);
    }
    group.sessions.push({ ...toLine(f.session), cancel: f.severity === 'cancel' });
  }
  return [...groups.values()];
}

function lines(findings: Finding[]): ScheduleLintLine[] {
  return findings.map((f) => ({
    rule: f.ruleLabel,
    message: f.message,
    ...(f.session && { session: toLine(f.session) }),
  }));
}

export function buildEmailProps(
  report: Pick<LintReport, 'findings' | 'horizonEnd'> & Partial<Pick<LintReport, 'resolved'>>
): ScheduleLintProps {
  const overlaps = report.findings.filter((f) => f.rule === 'special-event-overlap');
  const rest = report.findings.filter((f) => f.rule !== 'special-event-overlap');
  const fixes = rest.filter((f) => f.severity === 'fix');
  const notices = rest.filter((f) => f.severity === 'notice');

  return {
    // horizonEnd is an ET calendar date; label it as one, not as a UTC instant.
    horizonLabel: formatShortDate(`${report.horizonEnd}T12:00:00-04:00`),
    cancelCount: overlaps.filter((f) => f.severity === 'cancel').length,
    fixCount: fixes.length,
    noticeCount: notices.length + overlaps.filter((f) => f.severity !== 'cancel').length,
    resolvedCount: report.resolved?.length ?? 0,
    overlaps: overlapGroups(overlaps),
    fixes: lines(fixes),
    notices: lines(notices),
  };
}
