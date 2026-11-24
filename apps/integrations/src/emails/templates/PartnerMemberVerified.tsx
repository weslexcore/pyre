import { Hr, Text } from '@react-email/components';
import { COLORS, EmailLayout, heading, text } from '../components/EmailLayout';
import type { PartnerMemberVerifiedProps } from '../types';

// To the partner's contacts: Pyre confirms one of its members holds an active
// membership, so the partner can give them the member perk. Sent only after
// the member clicked their own confirm link, and only with what Momence said
// at that moment.

const detail = { ...text, margin: '0 0 4px' };

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  });

export function PartnerMemberVerified({
  partnerName,
  memberName,
  memberEmail,
  membershipName,
  memberSince,
  validThrough,
  memberPerk,
  verifiedAt,
}: PartnerMemberVerifiedProps) {
  return (
    <EmailLayout preview={`${memberName} is an active Pyre member`}>
      <Text style={heading}>Verified Pyre member</Text>
      <Text style={text}>
        {memberName} asked us to confirm their Pyre membership for {partnerName}. We checked, and it
        is active, so they qualify for your Pyre member perk: {memberPerk}.
      </Text>

      <Text style={detail}>
        <strong>Name:</strong> {memberName}
      </Text>
      <Text style={detail}>
        <strong>Email:</strong> {memberEmail}
      </Text>
      <Text style={detail}>
        <strong>Membership:</strong> {membershipName}
      </Text>
      {memberSince && (
        <Text style={detail}>
          <strong>Member since:</strong> {formatDate(memberSince)}
        </Text>
      )}
      <Text style={detail}>
        <strong>Valid through:</strong>{' '}
        {validThrough ? formatDate(validThrough) : 'Ongoing (renews monthly)'}
      </Text>
      <Text style={{ ...detail, margin: '0 0 20px' }}>
        <strong>Checked:</strong> {formatDate(verifiedAt)}
      </Text>

      <Hr style={{ borderColor: COLORS.sky, margin: '4px 0 20px' }} />
      <Text style={text}>
        Nothing to click. The member confirmed this request from their own inbox before we sent it.
        Questions, or think something's off? Just reply to this email.
      </Text>
      <Text style={text}>Thanks! Wes + Julien, Pyre Sauna</Text>
    </EmailLayout>
  );
}

PartnerMemberVerified.PreviewProps = {
  partnerName: 'BFT Carytown',
  memberName: 'Jane Doe',
  memberEmail: 'jane@example.com',
  membershipName: 'Founding Unlimited',
  memberSince: '2026-08-01T00:00:00.000Z',
  validThrough: null,
  memberPerk: '15% off class packs',
  verifiedAt: '2026-11-24T17:00:00.000Z',
} satisfies PartnerMemberVerifiedProps;

export default PartnerMemberVerified;
