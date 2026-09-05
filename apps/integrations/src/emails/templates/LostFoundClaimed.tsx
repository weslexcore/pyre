import { Button, Text } from '@react-email/components';
import { button, EmailLayout, heading, text } from '../components/EmailLayout';
import type { LostFoundClaimedProps } from '../types';

// To staff the moment a guest clicks "this is mine", so the item is set aside
// before they turn up for it. The claimant is whoever we emailed — the claim
// link carries a signed notice id, not a typed-in name — which is exactly what
// the person at the desk checks against at handover.

const detailRow = {
  ...text,
  margin: '0 0 4px',
};

export function LostFoundClaimed({
  reference,
  itemLabel,
  claimantLabel,
  claimantEmail,
  sessionLabel,
  itemUrl,
}: LostFoundClaimedProps) {
  return (
    <EmailLayout preview={`${claimantLabel} claimed the ${itemLabel.toLowerCase()} (${reference})`}>
      <Text style={heading}>Someone claimed a lost item</Text>

      <Text style={text}>
        {claimantLabel} says the {itemLabel.toLowerCase()} is theirs. Set it aside — they'll collect
        it on their next visit.
      </Text>

      <Text style={detailRow}>
        <strong>Item:</strong> {itemLabel} ({reference})
      </Text>
      <Text style={detailRow}>
        <strong>Claimed by:</strong> {claimantEmail}
      </Text>
      {sessionLabel && (
        <Text style={{ ...detailRow, margin: '0 0 20px' }}>
          <strong>Was in:</strong> {sessionLabel}
        </Text>
      )}

      <Button style={button} href={itemUrl}>
        Open the item
      </Button>

      <Text style={text}>
        Check the description on the record against what they describe before handing it over, then
        mark it picked up.
      </Text>
    </EmailLayout>
  );
}

LostFoundClaimed.PreviewProps = {
  reference: 'LF-2026-0007',
  itemLabel: 'Black water bottle',
  claimantLabel: 'Alex Rivera',
  claimantEmail: 'alex@example.com',
  sessionLabel: 'Social Sauna — Tue, Sep 2 at 6:00 PM',
  itemUrl:
    'https://pyre-integrations.vercel.app/admin/lost-found/2f0a0c6e-0000-4000-8000-000000000000',
} satisfies LostFoundClaimedProps;

export default LostFoundClaimed;
