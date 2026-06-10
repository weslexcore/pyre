import { Button, Column, Img, Row, Section, Text } from '@react-email/components';
import type { ConfirmationEmailProps } from '../types';
import { button, COLORS, EmailLayout, heading, text } from './EmailLayout';

const headerImage = {
  width: '100%',
  height: 'auto',
  borderRadius: '8px',
  margin: '0 0 24px',
};

const detailsSection = {
  backgroundColor: COLORS.creme,
  borderRadius: '8px',
  margin: '0 0 24px',
  padding: '20px 24px',
};

const labelStyle = {
  color: COLORS.black,
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
  preview,
  headingText,
  intro,
  headerImageUrl,
}: BaseProps) {
  return (
    <EmailLayout preview={preview}>
      {headerImageUrl && (
        <Img src={headerImageUrl} width="512" height="512" alt="" style={headerImage} />
      )}
      <Text style={heading}>{headingText}</Text>
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

      <Button href={manageUrl} style={button}>
        View &amp; manage your booking
      </Button>
    </EmailLayout>
  );
}

export const sampleConfirmationProps: ConfirmationEmailProps = {
  firstName: 'Alex',
  sessionTitle: 'Guided Sauna & Cold Plunge',
  dateLabel: 'Wed, February 12, 2026',
  timeLabel: '6:00 PM - 8:00 PM',
  location: 'Pyre Sauna — Brooklyn',
  manageUrl: 'https://pyresauna.com/account',
};
