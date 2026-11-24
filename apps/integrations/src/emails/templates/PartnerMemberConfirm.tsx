import { Button, Text } from '@react-email/components';
import { button, EmailLayout, heading, text } from '../components/EmailLayout';
import type { PartnerMemberConfirmProps } from '../types';

// To a Pyre member who asked, on /perks, for us to vouch for them at a
// partner. Nothing goes to the partner until they click: the click proves the
// address is theirs and is their OK to share their name and membership.

export function PartnerMemberConfirm({
  partnerName,
  memberPerk,
  confirmUrl,
  expiresDays,
}: PartnerMemberConfirmProps) {
  return (
    <EmailLayout preview={`Confirm to send your Pyre membership to ${partnerName}`}>
      <Text style={heading}>One click to claim your {partnerName} perk</Text>
      <Text style={text}>
        You asked us to let {partnerName} know you're a Pyre member, so you can get {memberPerk}.
      </Text>
      <Text style={text}>
        Click below and we'll check your membership. If it's active, we'll email {partnerName} your
        name, this email address, and the name of your membership. Nothing is shared until you
        click.
      </Text>
      <Button href={confirmUrl} style={button}>
        Send my membership to {partnerName}
      </Button>
      <Text style={text}>
        This link expires in {expiresDays} days. Didn't ask for this? Ignore this email and nothing
        happens.
      </Text>
      <Text style={text}>See you in the heat. Wes + Julien</Text>
    </EmailLayout>
  );
}

PartnerMemberConfirm.PreviewProps = {
  partnerName: 'BFT Carytown',
  memberPerk: '15% off class packs',
  confirmUrl: 'https://pyre-integrations.vercel.app/api/partner/member-confirm?token=preview',
  expiresDays: 2,
} satisfies PartnerMemberConfirmProps;

export default PartnerMemberConfirm;
