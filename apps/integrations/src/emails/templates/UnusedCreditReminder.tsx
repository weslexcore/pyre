import { Button, Hr, Text } from '@react-email/components';
import { button, COLORS, EmailLayout, heading, text } from '../components/EmailLayout';
import { emailLink } from '../components/utm';
import type { UnusedCreditReminderProps } from '../types';

const BOOK_URL = emailLink('https://pyresauna.com/events', 'unused-credit', 'use-a-credit');

export function UnusedCreditReminder({
  firstName,
  creditsLabel,
  unsubscribeUrl,
}: UnusedCreditReminderProps) {
  return (
    <EmailLayout
      preview={`You still have ${creditsLabel} waiting at Pyre`}
      background="trees"
      unsubscribeUrl={unsubscribeUrl}
    >
      <Text style={heading}>The sauna misses you, {firstName}</Text>
      <Text style={text}>
        It's been a little while - and you still have {creditsLabel} on your account, ready whenever
        you are.
      </Text>
      <Text style={text}>
        An hour of heat, a cold plunge, and you'll remember why you came the first time. Pick any
        session that fits your week.
      </Text>

      <Button href={BOOK_URL} style={button}>
        Use a credit
      </Button>

      <Hr style={{ borderColor: COLORS.sky, margin: '28px 0 20px' }} />
      <Text style={text}>
        Life gets busy - no guilt here. If something kept you away that we can fix, reply and tell
        us.
      </Text>
      <Text style={text}>Wes + Julien</Text>
    </EmailLayout>
  );
}

UnusedCreditReminder.PreviewProps = {
  firstName: 'Julien',
  creditsLabel: '2 credits',
  unsubscribeUrl: 'https://pyre-integrations.vercel.app/api/unsubscribe?token=preview',
} satisfies UnusedCreditReminderProps;

export default UnusedCreditReminder;
