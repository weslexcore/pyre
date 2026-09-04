// Builds the confirmation email's props from a resolved session.
//
// The one place this mapping lives: the webhook trigger uses it for real
// sends, and the preview/sample data (src/emails/preview-sessions.ts) uses it
// too, so what an admin previews is exactly what a guest receives.

import type { ConfirmationEmailProps } from '@/emails/types';
import { buildCalendarLinks } from '@/lib/calendar/links';
import type { ResolvedSession } from '@/lib/momence-events';
import { buildArrivalLabel } from './arrival';
import { getConfirmationContent } from './confirmation-content';

/**
 * `session` is null when Momence's events feed couldn't resolve the booking
 * (e.g. it already dropped off the upcoming feed). The email then degrades to
 * the essentials: no time, no arrival line, no calendar links.
 */
export function buildConfirmationProps(
  firstName: string,
  session: ResolvedSession | null
): ConfirmationEmailProps {
  const sessionType = session?.sessionType ?? 'unknown';

  return {
    firstName: firstName || 'there',
    sessionTitle: session?.title ?? 'Your Pyre session',
    dateLabel: session?.dateLabel ?? 'See your account for details',
    timeLabel: session?.timeLabel ?? '',
    arrivalLabel: session
      ? buildArrivalLabel(
          getConfirmationContent(sessionType).arrival,
          session.isoDate,
          session.endIso,
          { lastOfDay: session.isLastOfDay }
        )
      : undefined,
    location: session?.location ?? 'Pyre Sauna',
    sessionImageUrl: session?.imageUrl,
    sessionType,
    calendarLinks: session
      ? buildCalendarLinks({
          title: session.title,
          startIso: session.isoDate,
          endIso: session.endIso,
        })
      : undefined,
  };
}
