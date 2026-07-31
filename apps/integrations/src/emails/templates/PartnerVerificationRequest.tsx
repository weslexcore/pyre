import { Button, Hr, Link, Text } from '@react-email/components';
import { button, COLORS, EmailLayout, heading, text } from '../components/EmailLayout';
import type { PartnerVerificationRequestProps } from '../types';

// To the partner's contact: one click confirms or denies a customer's claimed
// membership. The links are HMAC-signed and single-use, so forwarding this
// email doesn't leak anything reusable.

const detail = {
  ...text,
  margin: '0 0 4px',
};

const denyLink = {
  color: COLORS.creme,
  fontSize: '14px',
  textDecoration: 'underline',
};

export function PartnerVerificationRequest({
  partnerName,
  customerName,
  customerEmail,
  partnerMemberEmail,
  confirmUrl,
  denyUrl,
  expiresDays,
}: PartnerVerificationRequestProps) {
  return (
    <EmailLayout preview={`Is ${customerName} a ${partnerName} member?`}>
      <Text style={heading}>Membership check from Pyre</Text>
      <Text style={text}>
        Someone asked for the {partnerName} member discount at Pyre. If they're an active member,
        one click below verifies them - they'll get their discount automatically at our checkout.
      </Text>

      <Text style={detail}>
        <strong>Name:</strong> {customerName}
      </Text>
      <Text style={{ ...detail, margin: partnerMemberEmail ? '0 0 4px' : '0 0 20px' }}>
        <strong>Email:</strong> {customerEmail}
      </Text>
      {partnerMemberEmail && (
        <Text style={{ ...detail, margin: '0 0 20px' }}>
          <strong>Email on their {partnerName} account:</strong> {partnerMemberEmail}
        </Text>
      )}

      <Button href={confirmUrl} style={button}>
        Confirm - they're a member
      </Button>
      <Text style={{ ...text, margin: '0 0 24px' }}>
        <Link href={denyUrl} style={denyLink}>
          Not a member? Let us know
        </Link>
      </Text>

      <Hr style={{ borderColor: COLORS.sky, margin: '4px 0 20px' }} />
      <Text style={text}>
        These links expire in {expiresDays} days. Questions? Just reply to this email.
      </Text>
      <Text style={text}>Thanks! Wes + Julien, Pyre Sauna</Text>
    </EmailLayout>
  );
}

PartnerVerificationRequest.PreviewProps = {
  partnerName: 'BFT Carytown',
  customerName: 'Jane Doe',
  customerEmail: 'jane@example.com',
  partnerMemberEmail: 'jane.doe@gmail.com',
  confirmUrl: 'https://pyre-integrations.vercel.app/api/partner/decision?token=preview-confirm',
  denyUrl: 'https://pyre-integrations.vercel.app/api/partner/decision?token=preview-deny',
  expiresDays: 14,
} satisfies PartnerVerificationRequestProps;

export default PartnerVerificationRequest;
