import { Hr, Link, Text } from '@react-email/components';
import { COLORS, EmailLayout, heading, text } from '../components/EmailLayout';
import type {
  ScheduleLintLine,
  ScheduleLintOverlapGroup,
  ScheduleLintProps,
  ScheduleLintSession,
} from '../types';

// To the admins whenever the schedule lint finds something new: regular
// sessions sitting under a special event (grouped by event, marked "cancel"
// or "review"), then anything wrong with a session itself, then notices.
// Every session title links to its Momence page — that is where the fix
// happens; nothing is changed from the email. Sent by the schedule-lint job.

const sectionTitle = {
  ...text,
  color: COLORS.creme,
  fontSize: '13px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  margin: '0 0 10px',
};

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

const row = {
  ...text,
  fontSize: '14px',
  lineHeight: '21px',
  margin: '0 0 6px',
  paddingLeft: '12px',
  borderLeft: `2px solid ${COLORS.sky}`,
};

const marker = (cancel: boolean) => ({
  color: cancel ? COLORS.red : COLORS.sky,
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

const divider = { borderColor: COLORS.sky, margin: '16px 0' };

function Title({ session }: { session: ScheduleLintSession }) {
  return session.link ? (
    <Link href={session.link} style={link}>
      {session.title}
    </Link>
  ) : (
    session.title
  );
}

function Meta({ session }: { session: ScheduleLintSession }) {
  return (
    <span style={muted}>
      {session.whenLabel} · {session.typeLabel}
      {session.bookingLabel ? ` · ${session.bookingLabel}` : ''}
    </span>
  );
}

function OverlapGroup({ group }: { group: ScheduleLintOverlapGroup }) {
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
        <Text key={`${session.title}-${session.whenLabel}-${session.typeLabel}`} style={row}>
          <span style={marker(session.cancel)}>{session.cancel ? 'cancel' : 'review'}</span>{' '}
          <Title session={session} />
          <br />
          <Meta session={session} />
        </Text>
      ))}
    </>
  );
}

const ruleTag = {
  color: COLORS.sky,
  fontSize: '11px',
  letterSpacing: '0.06em',
  textTransform: 'uppercase' as const,
};

function Line({ line }: { line: ScheduleLintLine }) {
  if (!line.session) {
    return (
      <Text style={row}>
        <span style={ruleTag}>{line.rule}</span> {line.message}
      </Text>
    );
  }
  return (
    <Text style={row}>
      <span style={ruleTag}>{line.rule}</span> <Title session={line.session} />
      <br />
      <Meta session={line.session} />
      <br />
      {line.message}
    </Text>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function ScheduleLint({
  horizonLabel,
  cancelCount,
  fixCount,
  noticeCount,
  overlaps,
  fixes,
  notices,
}: ScheduleLintProps) {
  const parts = [
    cancelCount > 0 && `${plural(cancelCount, 'session')} to cancel`,
    fixCount > 0 && `${fixCount} to fix`,
    noticeCount > 0 && plural(noticeCount, 'notice'),
  ].filter(Boolean);
  const summary = parts.join(', ');

  return (
    <EmailLayout preview={`Schedule check through ${horizonLabel}: ${summary}`}>
      <Text style={heading}>The Momence schedule needs a look</Text>
      <Text style={text}>
        Checked through {horizonLabel}: {summary}. Each title opens the session in Momence; this
        email changes nothing on its own. You will not hear about the same list twice — the next
        email comes when something on it changes.
      </Text>

      {overlaps.length > 0 && (
        <>
          <Hr style={divider} />
          <Text style={sectionTitle}>Special events on top of regular sessions</Text>
          <Text style={{ ...text, margin: '0 0 14px' }}>
            Guests can still book these. The ones marked <strong>cancel</strong> are Open Hours and
            Social slots that need to come off the calendar; <strong>review</strong> may be
            intentional.
          </Text>
          {overlaps.map((group, i) => (
            <div
              key={`${group.eventTitle}-${group.whenLabel}`}
              style={{ margin: i === 0 ? '0 0 18px' : '18px 0' }}
            >
              <OverlapGroup group={group} />
            </div>
          ))}
        </>
      )}

      {fixes.length > 0 && (
        <>
          <Hr style={divider} />
          <Text style={sectionTitle}>Fix</Text>
          {fixes.map((line) => (
            <Line key={`${line.session?.title ?? ''}-${line.message}`} line={line} />
          ))}
        </>
      )}

      {notices.length > 0 && (
        <>
          <Hr style={divider} />
          <Text style={sectionTitle}>Notices</Text>
          {notices.map((line) => (
            <Line key={`${line.session?.title ?? ''}-${line.message}`} line={line} />
          ))}
        </>
      )}
    </EmailLayout>
  );
}

ScheduleLint.PreviewProps = {
  horizonLabel: 'Oct 12',
  cancelCount: 5,
  fixCount: 2,
  noticeCount: 3,
  overlaps: [
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
          cancel: true,
          link: 'https://momence.com/s/13',
        },
        {
          title: 'Open Hours',
          whenLabel: 'Thu, Sep 17 · 7:00 PM – 8:00 PM EDT',
          typeLabel: 'Open hours',
          bookingLabel: 'No bookings',
          cancel: true,
        },
        {
          title: 'Open Hours',
          whenLabel: 'Thu, Sep 17 · 8:00 PM – 9:00 PM EDT',
          typeLabel: 'Open hours',
          bookingLabel: '1 booked',
          cancel: true,
        },
        {
          title: 'Guided Heat',
          whenLabel: 'Thu, Sep 17 · 8:00 PM – 9:00 PM EDT',
          typeLabel: 'Guided',
          bookingLabel: '4 booked',
          cancel: false,
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
          cancel: true,
        },
        {
          title: 'Social Evening — full evening',
          whenLabel: 'Fri, Sep 18 · 7:00 PM – 10:00 PM EDT',
          typeLabel: 'Social',
          bookingLabel: '3 booked',
          cancel: true,
        },
      ],
    },
  ],
  fixes: [
    {
      rule: 'Untagged sessions',
      message:
        'No session tag; guests get the generic confirmation and the site has no category for it',
      session: {
        title: 'Community Night',
        whenLabel: 'Wed, Sep 23 · 6:00 PM – 8:00 PM EDT',
        typeLabel: 'General',
        bookingLabel: '',
        link: 'https://momence.com/s/40',
      },
    },
    {
      rule: 'Drafts starting soon',
      message: 'Still a draft and starts Sat, Sep 19; publish it or delete it',
      session: {
        title: 'Open Hours',
        whenLabel: 'Sat, Sep 19 · 10:00 AM – 11:00 AM EDT',
        typeLabel: 'Open hours',
        bookingLabel: '',
      },
    },
  ],
  notices: [
    {
      rule: 'Capacity outliers',
      message: 'Capacity 4; the other Open hours sessions of this length are 12',
      session: {
        title: 'Open Hours',
        whenLabel: 'Sun, Sep 20 · 1:00 PM – 2:00 PM EDT',
        typeLabel: 'Open hours',
        bookingLabel: '1 booked',
        link: 'https://momence.com/s/51',
      },
    },
    {
      rule: 'Schedule running out',
      message:
        'Open Hours and Social are published through Sun, Sep 27 only; the site promises about three weeks ahead',
    },
  ],
} satisfies ScheduleLintProps;

export default ScheduleLint;
