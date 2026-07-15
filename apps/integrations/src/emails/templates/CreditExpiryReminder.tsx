import { Button, Hr, Text } from '@react-email/components';
import { button, COLORS, EmailLayout, heading, text } from '../components/EmailLayout';
import { emailLink } from '../components/utm';
import type { CreditExpiryReminderProps } from '../types';

const BOOK_URL = emailLink('https://pyresauna.com/events', 'credit-expiry', 'book-before-expiry');

export function CreditExpiryReminder({
  firstName,
  creditsLabel,
  expiresOn,
  daysLeft,
  unsubscribeUrl,
}: CreditExpiryReminderProps) {
  return (
    <EmailLayout
      preview={`Your ${creditsLabel} expire${daysLeft === 1 ? 's tomorrow' : ` on ${expiresOn}`} - come use them`}
      background="lamps"
      unsubscribeUrl={unsubscribeUrl}
    >
      <Text style={heading}>Don't let the heat go to waste, {firstName}</Text>
      <Text style={text}>
        You still have {creditsLabel} on your account, and they expire on {expiresOn}
        {daysLeft <= 3 ? ` - that's only ${daysLeft} day${daysLeft === 1 ? '' : 's'} away` : ''}.
      </Text>
      <Text style={text}>
        Grab a spot at any upcoming session - social, silent, or guided - and put them to good use.
      </Text>

      <Button href={BOOK_URL} style={button}>
        Book before they expire
      </Button>

      <Hr style={{ borderColor: COLORS.sky, margin: '28px 0 20px' }} />
      <Text style={text}>
        Can't make it in time? Reply and we'll see what we can do - we'd rather you sweat than lose
        them.
      </Text>
      <Text style={text}>Wes + Julien</Text>
    </EmailLayout>
  );
}

CreditExpiryReminder.PreviewProps = {
  firstName: 'Julien',
  creditsLabel: '3 credits',
  expiresOn: 'August 12',
  daysLeft: 3,
  unsubscribeUrl: 'https://pyre-integrations.vercel.app/api/unsubscribe?token=preview',
} satisfies CreditExpiryReminderProps;

export default CreditExpiryReminder;
