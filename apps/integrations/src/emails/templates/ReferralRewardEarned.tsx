import { Button, Text } from '@react-email/components';
import { button, EmailLayout, heading, text } from '../components/EmailLayout';
import type { ReferralRewardEarnedProps } from '../types';

// To the referrer when a friend they referred completes their first booking:
// their thank-you discount is live for their next session.

export function ReferralRewardEarned({
  firstName,
  friendFirstName,
  bookUrl,
}: ReferralRewardEarnedProps) {
  return (
    <EmailLayout preview="Your referral reward at Pyre is live" background="trees">
      <Text style={heading}>Nice one, {firstName}</Text>
      <Text style={text}>
        {friendFirstName} just booked their first session at Pyre — thanks to you. As a thank-you, a
        discount on your next session is now live on your account.
      </Text>
      <Text style={text}>
        Book with this email address and it comes off automatically at checkout. No code needed.
      </Text>
      <Button href={bookUrl} style={button}>
        Book your next session
      </Button>
      <Text style={text}>Keep them coming. Wes + Julien</Text>
    </EmailLayout>
  );
}

ReferralRewardEarned.PreviewProps = {
  firstName: 'Wes',
  friendFirstName: 'Jane',
  bookUrl: 'https://pyresauna.com/events?utm_source=referral-reward&utm_medium=referral',
} satisfies ReferralRewardEarnedProps;

export default ReferralRewardEarned;
