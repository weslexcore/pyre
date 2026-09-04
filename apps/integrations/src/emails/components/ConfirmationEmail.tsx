import { Button, Img, Link, Section, Text } from '@react-email/components';
import {
  APPLE_MAPS_URL,
  DIRECTIONS_URL,
  getConfirmationContent,
  locationLines,
  VENUE,
} from '@/lib/email/confirmation-content';
import { PARKING_DIRECTIONS, WEATHER_POLICY } from '@/lib/email/faq-content';
import { CONFIRMATION_PREVIEWS } from '../preview-sessions';
import type { ConfirmationEmailProps } from '../types';
import { ASSET_BASE, proxyImageUrl } from './assets';
import { button, COLORS, EmailLayout, heading, text } from './EmailLayout';

// The event photo sits below the details card so the essentials (when, where)
// stay above the fold on a phone — a square or portrait Momence image at full
// width used to push them a whole screen down.
const sessionImage = {
  width: '100%',
  height: 'auto',
  borderRadius: '8px',
  margin: '0 0 24px',
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
  margin: '0 0 4px',
  textTransform: 'uppercase' as const,
  fontFamily: 'monospace',
};

// Gap above every label after the first, so the card reads as stacked groups.
const groupLabelStyle = {
  ...labelStyle,
  margin: '20px 0 4px',
};

const faqLabelStyle = {
  ...labelStyle,
  color: COLORS.sky,
};

// The two lines a guest actually needs on the day — date and time — are the
// largest type in the email.
const bigValueStyle = {
  color: COLORS.creme,
  fontSize: '20px',
  fontWeight: 700,
  lineHeight: '28px',
  margin: 0,
};

const valueStyle = {
  color: COLORS.creme,
  fontSize: '16px',
  lineHeight: '24px',
  margin: 0,
};

const valueBoldStyle = {
  ...valueStyle,
  fontWeight: 700,
};

const noteStyle = {
  color: 'rgba(245, 241, 233, 0.8)',
  fontSize: '14px',
  lineHeight: '21px',
  margin: '6px 0 0',
};

const faqAnswerStyle = {
  color: COLORS.creme,
  fontSize: '16px',
  margin: '0 0 14px',
};

const inlineLinkStyle = {
  color: COLORS.creme,
  fontSize: '14px',
  textDecoration: 'underline',
};

const directionsButton = {
  ...button,
  fontSize: '14px',
  padding: '10px 18px',
  margin: '14px 12px 0 0',
};

/**
 * The single confirmation email. All per-session-type copy (heading, intro,
 * header image, background, FAQs) is resolved from `confirmation-content.ts`
 * via `sessionType`; this component owns the shared structure.
 *
 * Reading order is deliberate: greeting, then the details card (when / where /
 * calendar), then the type-specific copy, then the event photo, then FAQs.
 */
export function ConfirmationEmail({
  firstName,
  sessionTitle,
  dateLabel,
  timeLabel,
  arrivalLabel,
  location,
  // manageUrl,
  sessionImageUrl,
  sessionType,
  calendarLinks,
}: ConfirmationEmailProps) {
  const content = getConfirmationContent(sessionType);
  // Inbox snippet: the facts, not a restatement of the subject.
  const preview = timeLabel
    ? `${dateLabel} · ${timeLabel} · ${VENUE.street}, ${VENUE.cityStateZip}`
    : `You're booked for ${sessionTitle}`;
  const whereLines = locationLines(location);
  // Prefer the event's own image (the one shown on the landing page) over the
  // type's stock header.
  const imageUrl = proxyImageUrl(sessionImageUrl) || `${ASSET_BASE}/${content.headerImage}`;

  return (
    <EmailLayout preview={preview} background={content.background ?? 'clouds'}>
      <Text style={heading}>{content.headingText}</Text>
      <Text style={text}>
        Hi {firstName}, you're all set for {sessionTitle}.
      </Text>

      <Section style={detailsSection}>
        <Text style={labelStyle}>When</Text>
        <Text style={bigValueStyle}>{dateLabel}</Text>
        {timeLabel && <Text style={bigValueStyle}>{timeLabel}</Text>}
        {arrivalLabel && <Text style={noteStyle}>{arrivalLabel}</Text>}

        {calendarLinks && (
          <>
            <Text style={groupLabelStyle}>Add to calendar</Text>
            <Text style={valueStyle}>
              <Link href={calendarLinks.google} style={inlineLinkStyle}>
                Google
              </Link>
              {calendarLinks.ics && (
                <>
                  {' · '}
                  <Link href={calendarLinks.ics} style={inlineLinkStyle}>
                    Apple
                  </Link>
                </>
              )}
              {' · '}
              <Link href={calendarLinks.outlook} style={inlineLinkStyle}>
                Outlook
              </Link>
            </Text>
          </>
        )}

        <Text style={groupLabelStyle}>Where</Text>
        {whereLines.map((line, index) => (
          <Text key={line} style={index === 0 ? valueBoldStyle : valueStyle}>
            {line}
          </Text>
        ))}
        <Text style={{ margin: 0 }}>
          <Button href={DIRECTIONS_URL} style={directionsButton}>
            Get directions
          </Button>
          <Link href={APPLE_MAPS_URL} style={inlineLinkStyle}>
            Apple Maps
          </Link>
        </Text>
        <Text style={noteStyle}>Parking: {PARKING_DIRECTIONS}</Text>
      </Section>

      <Text style={text}>{content.introBody}</Text>
      <Text style={text}>
        Need to change or cancel? Just reply to this email. Cancel at least 2 hours before your
        start time and your credits go straight back to your account.
      </Text>
      <Text style={text}>Weather: {WEATHER_POLICY}</Text>

      {imageUrl && <Img src={imageUrl} width="512" alt="" style={sessionImage} />}

      {content.faqs.length > 0 && (
        <Section style={detailsSection}>
          {content.faqs.map((faq, index) => (
            <Section key={faq.question}>
              <Text style={faqLabelStyle}>{faq.question}</Text>
              <Text
                style={{
                  ...faqAnswerStyle,
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

// Re-exported so the per-type preview templates can keep importing it here.
export const sampleConfirmationProps: ConfirmationEmailProps = CONFIRMATION_PREVIEWS.guided;
