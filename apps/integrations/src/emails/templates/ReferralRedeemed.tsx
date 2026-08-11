import { Button, Text } from '@react-email/components';
import { button, EmailLayout, heading, text } from '../components/EmailLayout';
import type { ReferralRedeemedProps } from '../types';

// To the friend right after redeeming a referral code: the discount is already
// live on their account - no code to enter at checkout.

export function ReferralRedeemed({
  firstName,
  referrerName,
  discountPercent,
  bookUrl,
}: ReferralRedeemedProps) {
  return (
    <EmailLayout preview={`Your ${discountPercent}% off first session at Pyre`} background="trees">
      <Text style={heading}>Welcome, {firstName}</Text>
      <Text style={text}>
        {referrerName} sent you to us — your {discountPercent}% discount on your first session is
        now live at Pyre.
      </Text>
      <Text style={text}>
        Just sign up for a session with this email address and the discount comes off automatically
        at checkout. No code needed.
      </Text>
      <Button href={bookUrl} style={button}>
        Book your first session
      </Button>
      <Text style={text}>See you in the heat. Wes + Julien</Text>
    </EmailLayout>
  );
}

ReferralRedeemed.PreviewProps = {
  firstName: 'Jane',
  referrerName: 'Wes',
  discountPercent: 15,
  bookUrl: 'https://pyresauna.com/events?utm_source=referral&utm_medium=referral',
} satisfies ReferralRedeemedProps;

export default ReferralRedeemed;
