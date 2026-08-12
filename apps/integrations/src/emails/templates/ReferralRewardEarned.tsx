import { Button, Text } from '@react-email/components';
import { button, EmailLayout, heading, text } from '../components/EmailLayout';
import type { ReferralRewardEarnedProps } from '../types';

// To the referrer when a friend they referred completes their first booking:
// their reward — a fixed amount off their next purchase, applied by the
// reward tag's price rule — is live.

export function ReferralRewardEarned({
  firstName,
  friendFirstName,
  rewardLabel,
  bookUrl,
}: ReferralRewardEarnedProps) {
  return (
    <EmailLayout preview={`Your ${rewardLabel} reward at Pyre is live`} background="trees">
      <Text style={heading}>Nice one, {firstName}</Text>
      <Text style={text}>
        {friendFirstName} just booked their first session at Pyre — thanks to you. As a thank-you,
        {` ${rewardLabel}`} off your next purchase is now live on your account.
      </Text>
      <Text style={text}>
        It comes off automatically at checkout — sessions, credit packs, or memberships. No code
        needed, just use this email address.
      </Text>
      <Button href={bookUrl} style={button}>
        Use your reward
      </Button>
      <Text style={text}>Keep them coming. Wes + Julien</Text>
    </EmailLayout>
  );
}

ReferralRewardEarned.PreviewProps = {
  firstName: 'Wes',
  friendFirstName: 'Jane',
  rewardLabel: '$15',
  bookUrl: 'https://pyresauna.com/events?utm_source=referral-reward&utm_medium=referral',
} satisfies ReferralRewardEarnedProps;

export default ReferralRewardEarned;
