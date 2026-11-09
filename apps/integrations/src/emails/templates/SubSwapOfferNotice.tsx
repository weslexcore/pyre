import { Button, Text } from '@react-email/components';
import { button, EmailLayout, heading, text } from '../components/EmailLayout';
import type { SubSwapOfferNoticeProps } from '../types';

// To the person who asked for a sub when a teammate offers a swap instead of
// taking the shift outright: the offerer would take the requested shift and
// the requester would take one of the offerer's. Nothing has moved yet —
// Accept / Decline live on the schedule board.

export function SubSwapOfferNotice({
  firstName,
  offererName,
  shiftLabel,
  dateLabel,
  timeLabel,
  offeredShiftLabel,
  offeredDateLabel,
  offeredTimeLabel,
  note,
  scheduleUrl,
}: SubSwapOfferNoticeProps) {
  return (
    <EmailLayout preview={`${offererName} offered to swap shifts with you`}>
      <Text style={heading}>
        {offererName} offered you a swap, {firstName}
      </Text>
      <Text style={text}>
        Instead of just taking your {shiftLabel} shift on {dateLabel} ({timeLabel}), {offererName}{' '}
        is offering a trade: they take that shift, and you take their {offeredShiftLabel} shift on{' '}
        {offeredDateLabel} ({offeredTimeLabel}).
      </Text>
      {note ? <Text style={text}>They added: "{note}"</Text> : null}
      <Text style={text}>
        Nothing changes until you accept. If you'd rather hold out for someone to take the shift
        outright, decline and your sub request stays open.
      </Text>
      <Button style={button} href={scheduleUrl}>
        Accept or decline on the schedule
      </Button>
    </EmailLayout>
  );
}

SubSwapOfferNotice.PreviewProps = {
  firstName: 'Sunny',
  offererName: 'Omar',
  shiftLabel: 'Evening',
  dateLabel: 'Thursday, August 14',
  timeLabel: '2:30p–8:30p',
  offeredShiftLabel: 'Morning',
  offeredDateLabel: 'Saturday, August 16',
  offeredTimeLabel: '8:30a–2:30p',
  note: 'Happy to take Thursday if Saturday morning works for you.',
  scheduleUrl: 'https://pyre-integrations.vercel.app/admin/schedule',
} satisfies SubSwapOfferNoticeProps;

export default SubSwapOfferNotice;
