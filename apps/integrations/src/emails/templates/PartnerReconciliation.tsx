import { Hr, Text } from '@react-email/components';
import { COLORS, EmailLayout, heading, text } from '../components/EmailLayout';
import type { PartnerReconciliationProps } from '../types';

// Quarterly to the partner contact: everyone currently holding their discount
// tag at Pyre. Reply-driven on purpose - removals are rare enough that a
// one-line reply beats building partner-facing tooling.

const memberRow = {
  ...text,
  margin: '0 0 6px',
  fontSize: '14px',
  lineHeight: '22px',
};

export function PartnerReconciliation({
  partnerName,
  quarterLabel,
  members,
}: PartnerReconciliationProps) {
  return (
    <EmailLayout preview={`Quarterly member check - ${members.length} verified at Pyre`}>
      <Text style={heading}>Quarterly member check ({quarterLabel})</Text>
      <Text style={text}>
        These {partnerName} members currently get the partner discount at Pyre. Could you skim the
        list and reply with anyone who's no longer a member? If everyone checks out, no reply
        needed.
      </Text>

      <Hr style={{ borderColor: COLORS.sky, margin: '4px 0 16px' }} />
      {members.map((member) => (
        <Text key={member.email} style={memberRow}>
          {member.name} - {member.email}
        </Text>
      ))}
      <Hr style={{ borderColor: COLORS.sky, margin: '16px 0 20px' }} />

      <Text style={text}>
        Thanks for keeping this easy - and for sending your people our way. Wes + Julien, Pyre
        Sauna
      </Text>
    </EmailLayout>
  );
}

PartnerReconciliation.PreviewProps = {
  partnerName: 'BFT Carytown',
  quarterLabel: '2026-q3',
  members: [
    { name: 'Jane Doe', email: 'jane@example.com' },
    { name: 'Sam Smith', email: 'sam@example.com' },
  ],
} satisfies PartnerReconciliationProps;

export default PartnerReconciliation;
