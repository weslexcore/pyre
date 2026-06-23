import { Button, Hr, Link, Section, Text } from '@react-email/components';
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

FirstTimerWelcome.PreviewProps = {
  firstName: 'Julien',
  // manageUrl: 'https://pyresauna.com/account',
  directionsUrl: 'https://maps.google.com/?q=Pyre+Sauna',
  faqs: [
    {
      question: 'What should I bring to my session?',
      answer:
        'Bring a swimsuit, a water bottle and an optional robe / sandals. We provide towels and all the amenities you need for your session.',
    },
    {
      question: 'How hot does the sauna get?',
      answer: 'Our traditional Finnish saunas reach temperatures between 170-195°F.',
    },
    {
      question: 'How long should I stay in the sauna and cold plunge?',
      answer:
        'We recommend 10-20 minute sauna sessions followed by 1-3 minute cold plunge immersions. Repeat 2-4 rounds for optimal benefits.',
    },
    {
      question: 'Where should I park?',
      answer:
        'Street parking is available on Westover Hills Blvd. and W 49th St. You can also park in the gravel lot off W 49th St. (look for the big Pyre sign on our sauna) or in the lot off Westover Hills Blvd. marked by the Living Water sign.',
    },
  ],
} satisfies FirstTimerEmailProps;

export default FirstTimerWelcome;
