import { Button, Hr, Link, Text } from '@react-email/components';
import { button, COLORS, EmailLayout, heading, text } from '../components/EmailLayout';
import type { SessionConflictGroup, SessionConflictItem, SessionConflictsProps } from '../types';

// Monday morning to the admins: every regular session sitting under a
// special event in the next four weeks, grouped by event. The recurring
// slots the check exists for (Open Hours, Social) are marked "cancel"; any
// other overlap is marked "review" so a guided session is never cancelled by
// a default. Nothing is cancelled from the email — the button opens the
// review page, where an admin ticks the list and confirms. Sent by the
// session-conflicts cron job.

const eventTitle = {
  ...text,
  color: COLORS.creme,
  fontSize: '16px',
  fontWeight: 700,
  lineHeight: '24px',
  margin: '0 0 2px',
};

const eventWhen = {
  ...text,
  color: COLORS.sky,
  fontSize: '13px',
  lineHeight: '20px',
  margin: '0 0 10px',
};

const sessionRow = {
  ...text,
  fontSize: '14px',
  lineHeight: '21px',
  margin: '0 0 6px',
  paddingLeft: '12px',
  borderLeft: `2px solid ${COLORS.sky}`,
};

const marker = (preselected: boolean) => ({
  color: preselected ? COLORS.red : COLORS.sky,
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  fontSize: '11px',
  letterSpacing: '0.06em',
});

const muted = { color: COLORS.sky };

const link = {
  color: COLORS.creme,
  textDecoration: 'underline',
};

function SessionLine({ session }: { session: SessionConflictItem }) {
  const title = session.link ? (
    <Link href={session.link} style={link}>
      {session.title}
    </Link>
  ) : (
    session.title
  );
  return (
    <Text style={sessionRow}>
      <span style={marker(session.preselected)}>{session.preselected ? 'cancel' : 'review'}</span>{' '}
      {title}
      <br />
      <span style={muted}>
        {session.whenLabel} · {session.typeLabel}
        {session.bookingLabel ? ` · ${session.bookingLabel}` : ''}
      </span>
    </Text>
  );
}

function Group({ group }: { group: SessionConflictGroup }) {
  const title = group.link ? (
    <Link href={group.link} style={link}>
      {group.eventTitle}
    </Link>
  ) : (
    group.eventTitle
  );
  return (
    <>
      <Text style={eventTitle}>{title}</Text>
      <Text style={eventWhen}>
        {group.whenLabel}
        {group.location ? ` · ${group.location}` : ''}
      </Text>
      {group.sessions.map((session) => (
        <SessionLine
          key={`${group.eventTitle}-${session.title}-${session.whenLabel}`}
          session={session}
        />
      ))}
    </>
  );
}

export function SessionConflicts({
  horizonLabel,
  sessionCount,
  preselectedCount,
  eventCount,
  groups,
  reviewUrl,
  cancelSupported,
}: SessionConflictsProps) {
  const sessions = `${sessionCount} regular session${sessionCount === 1 ? '' : 's'}`;
  const events = `${eventCount} special event${eventCount === 1 ? '' : 's'}`;
  const reviewOnly = sessionCount - preselectedCount;

  return (
    <EmailLayout preview={`${sessions} to cancel before ${events}`}>
      <Text style={heading}>Special events are sitting on regular sessions</Text>
      <Text style={text}>
        Between now and {horizonLabel}, {sessions} overlap {events} on the Momence schedule. Guests
        can still book them. The ones marked <strong>cancel</strong> are Open Hours and Social slots
        that need to come off the calendar
        {reviewOnly > 0
          ? `; ${reviewOnly} other${reviewOnly === 1 ? '' : 's'} marked review may be intentional.`
          : '.'}
      </Text>

      <Hr style={{ borderColor: COLORS.sky, margin: '4px 0 16px' }} />
      {groups.map((group, i) => (
        <div
          key={`${group.eventTitle}-${group.whenLabel}`}
          style={{ margin: i === 0 ? '0 0 18px' : '18px 0' }}
        >
          <Group group={group} />
        </div>
      ))}
      <Hr style={{ borderColor: COLORS.sky, margin: '16px 0 20px' }} />

      <Button style={button} href={reviewUrl}>
        Review and cancel in Momence
      </Button>
      <Text style={text}>
        Tick the sessions to cancel and confirm; Momence cancels them and lets anyone booked know.
        {cancelSupported === false
          ? ' Cancelling through the API is not available on this account, so the page will point you to each session in the Momence dashboard instead.'
          : ''}
      </Text>
    </EmailLayout>
  );
}

SessionConflicts.PreviewProps = {
  horizonLabel: 'Oct 12',
  sessionCount: 6,
  preselectedCount: 5,
  eventCount: 2,
  groups: [
    {
      eventTitle: 'Sound Bath with Anna',
      whenLabel: 'Thu, Sep 17 · 7:00 PM – 9:00 PM EDT',
      location: 'Pyre Sauna',
      link: 'https://momence.com/s/1',
      sessions: [
        {
          title: 'Open Hours',
          whenLabel: 'Thu, Sep 17 · 6:00 PM – 8:00 PM EDT',
          typeLabel: 'Open hours',
          bookingLabel: '2 booked',
          preselected: true,
          link: 'https://momence.com/s/13',
        },
        {
          title: 'Open Hours',
          whenLabel: 'Thu, Sep 17 · 7:00 PM – 8:00 PM EDT',
          typeLabel: 'Open hours',
          bookingLabel: 'No bookings',
          preselected: true,
        },
        {
          title: 'Open Hours',
          whenLabel: 'Thu, Sep 17 · 8:00 PM – 9:00 PM EDT',
          typeLabel: 'Open hours',
          bookingLabel: '1 booked',
          preselected: true,
        },
        {
          title: 'Guided Heat',
          whenLabel: 'Thu, Sep 17 · 8:00 PM – 9:00 PM EDT',
          typeLabel: 'Guided',
          bookingLabel: '4 booked',
          preselected: false,
        },
      ],
    },
    {
      eventTitle: 'DJ Night with Lou',
      whenLabel: 'Fri, Sep 18 · 7:00 PM – 10:00 PM EDT',
      location: 'Pyre Sauna',
      sessions: [
        {
          title: 'Social Evening',
          whenLabel: 'Fri, Sep 18 · 7:00 PM – 8:00 PM EDT',
          typeLabel: 'Social',
          bookingLabel: '6 booked',
          preselected: true,
        },
        {
          title: 'Social Evening — full evening',
          whenLabel: 'Fri, Sep 18 · 7:00 PM – 10:00 PM EDT',
          typeLabel: 'Social',
          bookingLabel: '3 booked',
          preselected: true,
        },
      ],
    },
  ],
  reviewUrl: 'https://pyre-integrations.vercel.app/admin/session-conflicts',
} satisfies SessionConflictsProps;

export default SessionConflicts;
