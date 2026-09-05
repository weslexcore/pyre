import { Button, Img, Text } from '@react-email/components';
import { indefiniteArticle } from '@/lib/lost-found/types';
import { button, EmailLayout, heading, text } from '../components/EmailLayout';
import type { LostFoundFoundProps } from '../types';

// To a guest who may have left something behind — either the person we think
// owns it, or everyone who was in session while it was left.
//
// The photo carries the whole email: someone recognises their own bottle in a
// second, and no wording beats that. The written description stays broad on
// purpose — a blast that says "silver ring, engraved M.K." tells a stranger
// exactly what to say to claim it. The identifying detail lives in the record
// for staff to check at pickup.
//
// The donation date is stated plainly rather than as "30 days": a date is
// something you can act on.

const detailRow = {
  ...text,
  margin: '0 0 4px',
};

const photo = {
  borderRadius: '6px',
  display: 'block',
  margin: '0 0 20px',
  maxWidth: '100%',
};

const footnote = {
  ...text,
  fontSize: '14px',
  lineHeight: '22px',
  opacity: 0.75,
};

export function LostFoundFound({
  firstName,
  reference,
  itemLabel,
  foundDateLabel,
  donateDateLabel,
  donationPartner,
  claimUrl,
  photoUrl,
}: LostFoundFoundProps) {
  const greeting = firstName ? `${firstName} — we` : 'We';

  return (
    <EmailLayout preview={`Is this yours? ${itemLabel} left at Pyre`}>
      <Text style={heading}>Did you leave this behind?</Text>

      {photoUrl && <Img src={photoUrl} alt={itemLabel} style={photo} />}

      <Text style={text}>
        {greeting} found {indefiniteArticle(itemLabel)} {itemLabel.toLowerCase()} at Pyre on{' '}
        {foundDateLabel} and we're trying to get it back to whoever it belongs to.
      </Text>

      <Text style={{ ...detailRow, margin: '0 0 20px' }}>
        <strong>Found:</strong> {foundDateLabel}
      </Text>

      {claimUrl && (
        <Button style={button} href={claimUrl}>
          This is mine
        </Button>
      )}

      <Text style={text}>
        {claimUrl
          ? "Tap the button and we'll set it aside for you to pick up on your next visit."
          : `Reply to this email if it's yours and we'll set it aside for your next visit.`}
      </Text>

      <Text style={footnote}>
        Anything still unclaimed is donated to {donationPartner} — this one goes on{' '}
        {donateDateLabel}. If it isn't yours, no need to do anything. ({reference})
      </Text>
    </EmailLayout>
  );
}

LostFoundFound.PreviewProps = {
  firstName: 'Alex',
  reference: 'LF-2026-0007',
  itemLabel: 'Black water bottle',
  foundDateLabel: 'Tuesday, September 2',
  donateDateLabel: 'October 2',
  donationPartner: 'Furbish Thrift',
  claimUrl: 'https://pyre-integrations.vercel.app/api/lost-found/claim?token=preview.preview',
  photoUrl: undefined,
} satisfies LostFoundFoundProps;

export default LostFoundFound;
