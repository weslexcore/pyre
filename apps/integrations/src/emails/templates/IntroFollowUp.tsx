import { Button, Hr, Text } from '@react-email/components';
import { button, COLORS, EmailLayout, heading, text } from '../components/EmailLayout';
import type { IntroFollowUpProps } from '../types';

const BOOK_URL = 'https://pyresauna.com/events';

export function IntroFollowUp({ firstName, unsubscribeUrl }: IntroFollowUpProps) {
  return (
    <EmailLayout
      preview="How was your first session? Your second credit is waiting."
      background="trees"
      unsubscribeUrl={unsubscribeUrl}
    >
      <Text style={heading}>How was it, {firstName}?</Text>
      <Text style={text}>
        We hope your first session left you feeling like we do after a good sweat and a cold plunge
        — clear-headed and a little bit invincible.
      </Text>
      <Text style={text}>
        If you started with our intro offer, your second credit is already on your account — no
        expiration pressure, just pick a session that fits your week.
      </Text>

      <Button href={BOOK_URL} style={button}>
        Book your next session
      </Button>

      <Hr style={{ borderColor: COLORS.sky, margin: '28px 0 20px' }} />
      <Text style={text}>
        Questions about heat, cold, breathwork, or anything in between? Just reply — one of us will
        answer personally.
      </Text>
      <Text style={text}>Wes + Julien</Text>
    </EmailLayout>
  );
}

IntroFollowUp.PreviewProps = {
  firstName: 'Julien',
  unsubscribeUrl: 'https://pyre-integrations.vercel.app/api/unsubscribe?token=preview',
} satisfies IntroFollowUpProps;

export default IntroFollowUp;
