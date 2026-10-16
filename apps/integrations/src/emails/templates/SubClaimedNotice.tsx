import { Button, Text } from '@react-email/components';
import { button, EmailLayout, heading, text } from '../components/EmailLayout';
import type { SubClaimedNoticeProps } from '../types';

// To every admin when someone takes a requested sub: the swap already
// happened (requester off, taker on), so this just closes the loop opened by
// SubRequestNotice — no action needed.

export function SubClaimedNotice({
  takerName,
  requesterName,
  shiftLabel,
  dateLabel,
  timeLabel,
  scheduleUrl,
  untrainedDuties,
}: SubClaimedNoticeProps) {
  return (
    <EmailLayout preview={`${takerName} is covering ${shiftLabel} on ${dateLabel}`}>
      <Text style={heading}>
        {untrainedDuties ? 'Sub found — one duty needs a home' : 'Sub found — no action needed'}
      </Text>
      <Text style={text}>
        {takerName} took {requesterName}'s {shiftLabel} shift on {dateLabel} ({timeLabel}). The
        schedule already shows the swap.
      </Text>
      {untrainedDuties ? (
        <Text style={text}>
          {takerName} isn't trained on {untrainedDuties}, so it wasn't carried over. Give it to
          someone else on the shift.
        </Text>
      ) : null}
      <Button style={button} href={scheduleUrl}>
        Open the schedule
      </Button>
    </EmailLayout>
  );
}

SubClaimedNotice.PreviewProps = {
  takerName: 'Omar',
  requesterName: 'Sunny',
  shiftLabel: 'Evening',
  dateLabel: 'Thursday, August 14',
  timeLabel: '2:30p–8:30p',
  scheduleUrl: 'https://pyre-integrations.vercel.app/admin/schedule',
} satisfies SubClaimedNoticeProps;

export default SubClaimedNotice;
