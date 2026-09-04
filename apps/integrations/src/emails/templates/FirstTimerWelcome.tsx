import { Button, Hr, Link, Section, Text } from '@react-email/components';
import { DIRECTIONS_URL } from '@/lib/email/confirmation-content';
import { FIRST_TIMER_FAQS } from '@/lib/email/faq-content';
import { button, COLORS, EmailLayout, heading, text } from '../components/EmailLayout';
import type { FirstTimerEmailProps } from '../types';

const faqQuestion = {
  color: COLORS.creme,
  fontSize: '15px',
  fontWeight: 600,
  margin: '0 0 4px',
};

const faqAnswer = {
  color: 'rgba(245, 241, 233, 0.8)',
  fontSize: '14px',
  lineHeight: '22px',
  margin: '0 0 16px',
};

const linkStyle = {
  color: COLORS.red,
  textDecoration: 'underline',
};

export function FirstTimerWelcome({
  firstName,
  faqs,
  // manageUrl,
  directionsUrl,
}: FirstTimerEmailProps) {
  return (
    <EmailLayout
      preview="Welcome to Pyre — what to expect for your first session"
      background="trees"
    >
      <Text style={heading}>Welcome, {firstName}</Text>
      <Text style={text}>
        We're so glad you booked your first session. Here's a little of what to expect so you can
        walk in feeling relaxed and ready.
      </Text>
      <Text style={text}>
        Bring a swimsuit and a water bottle. We'll provide everything else you'll need. Arrive up to
        10 minutes early to check in and get changed.
      </Text>

      <Button href={directionsUrl} style={button}>
        Get directions
      </Button>

      <Hr style={{ borderColor: COLORS.sky, margin: '28px 0 20px' }} />

      <Text style={heading}>Good to know</Text>
      <Section>
        {faqs.map((faq) => (
          <Section key={faq.question}>
            <Text style={faqQuestion}>{faq.question}</Text>
            <Text style={faqAnswer}>{faq.answer}</Text>
          </Section>
        ))}
      </Section>
      <Hr style={{ borderColor: COLORS.gold, margin: '28px 0 20px' }} />
      <Text style={text}>
        If you have any questions or need to modify your reservation, just reply to this email.
      </Text>
      <Text style={text}>See you soon!</Text>
      <Text style={text}>Wes + Julien</Text>
    </EmailLayout>
  );
}

// Preview mirrors the real send path (booking-confirmation.ts): both the FAQ
// set and the directions URL are imported rather than restated, so the preview
// cannot drift from what actually sends.
FirstTimerWelcome.PreviewProps = {
  firstName: 'Julien',
  // manageUrl: 'https://pyresauna.com/account',
  directionsUrl: DIRECTIONS_URL,
  faqs: FIRST_TIMER_FAQS,
} satisfies FirstTimerEmailProps;

export default FirstTimerWelcome;
