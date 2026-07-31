import { Button, Text } from '@react-email/components';
import { button, EmailLayout, heading, text } from '../components/EmailLayout';
import type { PartnerVerifiedProps } from '../types';

// To the customer after the partner confirms: the discount is already live on
// their account - no code to enter.

export function PartnerVerified({
  firstName,
  partnerName,
  discountPercent,
  bookUrl,
}: PartnerVerifiedProps) {
  return (
    <EmailLayout preview={`Your ${partnerName} discount at Pyre is live`} background="trees">
      <Text style={heading}>You're verified, {firstName}</Text>
      <Text style={text}>
        {partnerName} confirmed your membership, so your {discountPercent}% discount on sessions and
        credit packs is now live at Pyre.
      </Text>
      <Text style={text}>
        There's no code to enter - just book with the same email you used to verify, and the
        discount comes off automatically at checkout.
      </Text>
      <Button href={bookUrl} style={button}>
        Book a session
      </Button>
      <Text style={text}>See you in the heat. Wes + Julien</Text>
    </EmailLayout>
  );
}

PartnerVerified.PreviewProps = {
  firstName: 'Jane',
  partnerName: 'BFT Carytown',
  discountPercent: 15,
  bookUrl: 'https://pyresauna.com/events?utm_source=bft&utm_medium=partner',
} satisfies PartnerVerifiedProps;

export default PartnerVerified;
