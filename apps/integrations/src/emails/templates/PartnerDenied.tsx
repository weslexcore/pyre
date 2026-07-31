import { Text } from '@react-email/components';
import { EmailLayout, heading, text } from '../components/EmailLayout';
import type { PartnerDeniedProps } from '../types';

// To the customer when the partner couldn't confirm them ('denied') or nobody
// responded before the links expired ('expired'). Kept warm - a mismatch is
// usually a wrong email, not a fraud attempt.

export function PartnerDenied({ firstName, partnerName, reason }: PartnerDeniedProps) {
  return (
    <EmailLayout preview="About your Pyre partner discount request">
      <Text style={heading}>About your discount request, {firstName}</Text>
      {reason === 'denied' ? (
        <Text style={text}>
          We checked with {partnerName} and they couldn't match your request to an active
          membership, so we weren't able to set up the partner discount this time.
        </Text>
      ) : (
        <Text style={text}>
          We weren't able to get your membership confirmed with {partnerName} in time, so your
          request has expired. This is usually just a slow inbox on their end - feel free to submit
          again.
        </Text>
      )}
      <Text style={text}>
        If you think this is a mistake - maybe your {partnerName} account uses a different email -
        just reply to this email and we'll sort it out.
      </Text>
      <Text style={text}>Either way, we'd love to have you in the sauna. Wes + Julien</Text>
    </EmailLayout>
  );
}

PartnerDenied.PreviewProps = {
  firstName: 'Jane',
  partnerName: 'BFT Carytown',
  reason: 'denied',
} satisfies PartnerDeniedProps;

export default PartnerDenied;
