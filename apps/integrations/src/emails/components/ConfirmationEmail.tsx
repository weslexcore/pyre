import { Button, Column, Img, Row, Section, Text } from '@react-email/components';
import type { ConfirmationEmailProps } from '../types';
import { button, COLORS, type EmailBackground, EmailLayout, heading, text } from './EmailLayout';

const headerImage = {
  width: '100%',
  height: 'auto',
  // maxWidth: '250px',
  borderRadius: '8px',
  margin: '24px auto',
};

const detailsSection = {
  backgroundColor: COLORS.creme,
  borderRadius: '8px',
  margin: '0 0 24px',
  padding: '20px 24px',
};

const labelStyle = {
  color: COLORS.red,
  fontSize: '12px',
  letterSpacing: '0.06em',
  margin: '0 0 2px',
  textTransform: 'uppercase' as const,
};

const valueStyle = {
  color: COLORS.black,
  fontSize: '16px',
  fontWeight: 600,
  margin: '0 0 14px',
};

interface BaseProps extends ConfirmationEmailProps {
  preview: string;
  headingText: string;
  intro: string;
  headerImageUrl?: string;
  background?: EmailBackground;
}

/**
 * Shared confirmation shell. The guided / social / general templates wrap this
 * with their own preview text, heading, and intro copy.
 */
export function ConfirmationEmail({
  firstName,
  sessionTitle,
  dateLabel,
  timeLabel,
  location,
  manageUrl,
  sessionImageUrl,
  preview,
  headingText,
  intro,
  headerImageUrl,
  background = 'clouds',
}: BaseProps) {
  // Prefer the event's own image (the one shown on the landing page) over the
  // template's stock header.
  const imageUrl = sessionImageUrl || headerImageUrl;
  return (
    <EmailLayout preview={preview} background={background}>

      <Text style={heading}>{headingText}</Text>
      {imageUrl && <Img src={imageUrl} width="512" height="512" alt="" style={headerImage} />}
      <Text style={text}>Hi {firstName},</Text>
      <Text style={text}>{intro}</Text>

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
        <Text style={{ ...valueStyle, margin: 0 }}>{location}</Text>
      </Section>

      <Text style={text}>If you need to update your booking or chat with us, just reply to this email.</Text>
      <Text style={text}>See you soon!</Text>
    </EmailLayout>
  );
}

export const sampleConfirmationProps: ConfirmationEmailProps = {
  firstName: 'Alex',
  sessionTitle: 'Signature Guided Class',
  dateLabel: 'Sat, June 20, 2026',
  timeLabel: '10:00 AM - 12:00 PM',
  location: '1000 Westover Hills Blvd, Richmond, VA 23225',
  manageUrl: 'https://momence.com/sign-in',
};
