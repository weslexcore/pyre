import { Button, Text } from '@react-email/components';
import { button, EmailLayout, heading, text } from '../components/EmailLayout';
import type { SubRequestNoticeProps } from '../types';

// To every admin when an employee requests a sub for a shift they're assigned
// to. Their hours are already logged as time off and the available people
// have their claim links — the admins only need to step in if nobody bites.

export function SubRequestNotice({
  staffName,
  shiftLabel,
  dateLabel,
  timeLabel,
  notifiedCount,
  scheduleUrl,
}: SubRequestNoticeProps) {
  return (
    <EmailLayout preview={`${staffName} needs a sub: ${shiftLabel} on ${dateLabel}`}>
      <Text style={heading}>{staffName} requested a sub</Text>
      <Text style={text}>
        {staffName} asked for a sub on the {shiftLabel} shift, {dateLabel} ({timeLabel}). The date
        is logged in their time off, and they stay on the shift until someone takes it.
      </Text>
      <Text style={text}>
        {notifiedCount > 0
          ? `${notifiedCount} available ${notifiedCount === 1 ? 'person was' : 'people were'} emailed a one-click link to take the shift — you'll get another email when someone does.`
          : 'Nobody else is available that day, so this one needs your help to cover.'}
      </Text>
      <Button style={button} href={scheduleUrl}>
        Open the schedule
      </Button>
    </EmailLayout>
  );
}

SubRequestNotice.PreviewProps = {
  staffName: 'Sunny',
  shiftLabel: 'Evening',
  dateLabel: 'Thursday, August 14',
  timeLabel: '2:30p–8:30p',
  notifiedCount: 3,
  scheduleUrl: 'https://pyre-integrations.vercel.app/admin/schedule',
} satisfies SubRequestNoticeProps;

export default SubRequestNotice;
