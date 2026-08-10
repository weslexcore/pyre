import { Column, Img, Link, Row, Section, Text } from '@react-email/components';
import { DIRECTIONS_URL, getConfirmationContent } from '@/lib/email/confirmation-content';
import type { ConfirmationEmailProps } from '../types';
import { ASSET_BASE, proxyImageUrl } from './assets';
import { COLORS, EmailLayout, text } from './EmailLayout';

const headerImage = {
  width: '100%',
  height: 'auto',
  // maxWidth: '250px',
  borderRadius: '8px',
  margin: '24px auto',
};

const detailsSection = {
  backgroundColor: COLORS.blackSoft,
  borderRadius: '8px',
  margin: '0 0 24px',
  padding: '20px 24px',
};

const labelStyle = {
  color: COLORS.gold,
  fontSize: '12px',
  letterSpacing: '0.06em',
  margin: '0 0 2px',
  textTransform: 'uppercase' as const,
  fontFamily: 'monospace',
};

const faqLabelStyle = {
  ...labelStyle,
  color: COLORS.sky,
};

const valueStyle = {
  color: COLORS.creme,
  fontSize: '16px',
  // fontWeight: 600,
  margin: '0 0 14px',
};

const calendarLinkStyle = {
  color: COLORS.creme,
  fontSize: '14px',
  textDecoration: 'underline',
};

/**
 * The single confirmation email. All per-session-type copy (heading, intro,
 * header image, background, FAQs) is resolved from `confirmation-content.ts`
 * via `sessionType`; this component owns the shared structure.
 */
export function ConfirmationEmail({
  firstName,
  sessionTitle,
  dateLabel,
  timeLabel,
  location,
  // manageUrl,
  sessionImageUrl,
  sessionType,
  calendarLinks,
}: ConfirmationEmailProps) {
  const content = getConfirmationContent(sessionType);
  const preview = `You're booked for ${sessionTitle}`;
  const intro = `You're all set for ${sessionTitle} on ${dateLabel} from ${timeLabel}. \n\n${content.introBody}`;
  // Prefer the event's own image (the one shown on the landing page) over the
  // type's stock header.
  const imageUrl = proxyImageUrl(sessionImageUrl) || `${ASSET_BASE}/${content.headerImage}`;
  return (
    <EmailLayout preview={preview} background={content.background ?? 'clouds'}>
      {imageUrl && <Img src={imageUrl} width="512" height="512" alt="" style={headerImage} />}
      <Text style={text}>Hi {firstName},</Text>
      <Text style={text}>{intro}</Text>

      <Text style={text}>
        If you need to update your booking or have any other questions, just reply to this email.
      </Text>

      <Section style={detailsSection}>
        <Text style={labelStyle}>Session</Text>
        <Text style={valueStyle}>{sessionTitle}</Text>
        <Row>
          <Column>
            <Text style={labelStyle}>Date</Text>
            <Text style={{ ...valueStyle, margin: '0 0 14px' }}>{dateLabel}</Text>
          </Column>
          <Column>
            <Text style={labelStyle}>Time</Text>
            <Text style={{ ...valueStyle, margin: '0 0 14px' }}>{timeLabel}</Text>
          </Column>
        </Row>
        <Text style={labelStyle}>Location</Text>
        <Text style={{ ...valueStyle, margin: '0 0 4px' }}>{location}</Text>
        <Text style={{ ...valueStyle, fontSize: '14px', margin: calendarLinks ? '0 0 14px' : 0 }}>
          <Link href={DIRECTIONS_URL} style={calendarLinkStyle}>
            Directions &amp; parking
          </Link>
        </Text>
        {calendarLinks && (
          <>
            <Text style={labelStyle}>Add to calendar</Text>
            <Text style={{ ...valueStyle, fontSize: '14px', margin: 0 }}>
              <Link href={calendarLinks.google} style={calendarLinkStyle}>
                Google
              </Link>
              {calendarLinks.ics && (
                <>
                  {' · '}
                  <Link href={calendarLinks.ics} style={calendarLinkStyle}>
                    Apple
                  </Link>
                </>
              )}
              {' · '}
              <Link href={calendarLinks.outlook} style={calendarLinkStyle}>
                Outlook
              </Link>
            </Text>
          </>
        )}
      </Section>
      {content.faqs.length > 0 && (
        <Section style={detailsSection}>
          {content.faqs.map((faq, index) => (
            <Section key={faq.question}>
              <Text style={faqLabelStyle}>{faq.question}</Text>
              <Text
                style={{
                  ...valueStyle,
                  margin: index === content.faqs.length - 1 ? 0 : '0 0 14px',
                }}
              >
                {faq.answer}
              </Text>
            </Section>
          ))}
        </Section>
      )}
    </EmailLayout>
  );
}

export const sampleConfirmationProps: ConfirmationEmailProps = {
  firstName: 'Julien',
  sessionTitle: 'Signature Guided Class',
  dateLabel: 'Sat, June 20, 2026',
  timeLabel: '10:00 AM - 12:00 PM',
  location: '1000 Westover Hills Blvd, Richmond, VA 23225',
  sessionType: 'guided',
  // manageUrl: 'https://momence.com/sign-in',
  calendarLinks: {
    google:
      'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Signature+Guided+Class&dates=20260620T140000Z%2F20260620T160000Z&location=Pyre+Sauna%2C+1000+Westover+Hills+Blvd%2C+Richmond%2C+VA+23225',
    outlook:
      'https://outlook.live.com/calendar/0/action/compose?rru=addevent&subject=Signature+Guided+Class&startdt=2026-06-20T14%3A00%3A00Z&enddt=2026-06-20T16%3A00%3A00Z',
    ics: 'https://pyre-integrations.vercel.app/api/calendar/event.ics?d=sample',
  },
};
