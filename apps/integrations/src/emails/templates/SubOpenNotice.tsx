import { Button, Link, Text } from '@react-email/components';
import { button, EmailLayout, heading, text } from '../components/EmailLayout';
import type { SubOpenNoticeProps } from '../types';

// To each person who is free on the shift's date when a teammate requests a
// sub. The button is a signed one-click claim link bound to this recipient —
// first come, first served.

export function SubOpenNotice({
  firstName,
  requesterName,
  shiftLabel,
  dateLabel,
  timeLabel,
  claimUrl,
  scheduleUrl,
}: SubOpenNoticeProps) {
  return (
    <EmailLayout preview={`Can you cover ${shiftLabel} on ${dateLabel}?`}>
      <Text style={heading}>Can you cover a shift, {firstName}?</Text>
      <Text style={text}>
        {requesterName} needs a sub for the {shiftLabel} shift on {dateLabel} ({timeLabel}), and
        you're marked available that day.
      </Text>
      <Text style={text}>
        If you can take it, click below — first come, first served. The shift moves to you right
        away and the schedule updates for everyone.
      </Text>
      <Button style={button} href={claimUrl}>
        I'll take this shift
      </Button>
      <Text style={text}>
        Can't make it? No need to do anything. You can also check the full{' '}
        <Link href={scheduleUrl}>schedule board</Link> first.
      </Text>
    </EmailLayout>
  );
}

SubOpenNotice.PreviewProps = {
  firstName: 'Omar',
  requesterName: 'Sunny',
  shiftLabel: 'Evening',
  dateLabel: 'Thursday, August 14',
  timeLabel: '2:30p–8:30p',
  claimUrl: 'https://pyre-integrations.vercel.app/api/schedule/sub-claim?token=example',
  scheduleUrl: 'https://pyre-integrations.vercel.app/admin/schedule',
} satisfies SubOpenNoticeProps;

export default SubOpenNotice;
