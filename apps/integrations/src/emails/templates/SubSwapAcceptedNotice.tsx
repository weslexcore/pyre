import { Button, Text } from '@react-email/components';
import { button, EmailLayout, heading, text } from '../components/EmailLayout';
import type { SubSwapAcceptedNoticeProps } from '../types';

// To every admin, and to the offerer, when a requester accepts a swap offer:
// both assignments already moved (offerer onto the requested shift, requester
// onto the offered one), so this closes the loop opened by SubRequestNotice.

export function SubSwapAcceptedNotice({
  offererName,
  requesterName,
  shiftLabel,
  dateLabel,
  timeLabel,
  offeredShiftLabel,
  offeredDateLabel,
  offeredTimeLabel,
  scheduleUrl,
  untrainedDuties,
  untrainedOfferedDuties,
}: SubSwapAcceptedNoticeProps) {
  const anyUntrained = Boolean(untrainedDuties || untrainedOfferedDuties);
  return (
    <EmailLayout preview={`${offererName} and ${requesterName} swapped shifts`}>
      <Text style={heading}>
        {anyUntrained
          ? 'Shifts swapped — a duty needs a home'
          : 'Shifts swapped — no action needed'}
      </Text>
      <Text style={text}>
        {requesterName} accepted {offererName}'s swap offer. {offererName} now has the {shiftLabel}{' '}
        shift on {dateLabel} ({timeLabel}), and {requesterName} has the {offeredShiftLabel} shift on{' '}
        {offeredDateLabel} ({offeredTimeLabel}). The schedule already shows both changes.
      </Text>
      {untrainedDuties ? (
        <Text style={text}>
          {offererName} isn't trained on {untrainedDuties}, so it wasn't carried over on {dateLabel}
          . Give it to someone else on that shift.
        </Text>
      ) : null}
      {untrainedOfferedDuties ? (
        <Text style={text}>
          {requesterName} isn't trained on {untrainedOfferedDuties}, so it wasn't carried over on{' '}
          {offeredDateLabel}. Give it to someone else on that shift.
        </Text>
      ) : null}
      <Button style={button} href={scheduleUrl}>
        Open the schedule
      </Button>
    </EmailLayout>
  );
}

SubSwapAcceptedNotice.PreviewProps = {
  offererName: 'Omar',
  requesterName: 'Sunny',
  shiftLabel: 'Evening',
  dateLabel: 'Thursday, August 14',
  timeLabel: '2:30p–8:30p',
  offeredShiftLabel: 'Morning',
  offeredDateLabel: 'Saturday, August 16',
  offeredTimeLabel: '8:30a–2:30p',
  scheduleUrl: 'https://pyre-integrations.vercel.app/admin/schedule',
} satisfies SubSwapAcceptedNoticeProps;

export default SubSwapAcceptedNotice;
