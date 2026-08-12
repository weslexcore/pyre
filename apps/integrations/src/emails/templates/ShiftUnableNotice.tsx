import { Button, Text } from '@react-email/components';
import { button, EmailLayout, heading, text } from '../components/EmailLayout';
import type { ShiftUnableNoticeProps } from '../types';

// To every admin when an employee hits "unable to work" on a shift they were
// assigned to: they've already been taken off the shift and the date logged
// as time off, so the job here is coverage — get someone else on it.

export function ShiftUnableNotice({
  staffName,
  shiftLabel,
  dateLabel,
  timeLabel,
  scheduleUrl,
}: ShiftUnableNoticeProps) {
  return (
    <EmailLayout preview={`${staffName} can't work ${shiftLabel} on ${dateLabel}`}>
      <Text style={heading}>
        {staffName} can't work the {shiftLabel} shift
      </Text>
      <Text style={text}>
        {staffName} marked themselves unable to work {shiftLabel} on {dateLabel} ({timeLabel}).
      </Text>
      <Text style={text}>
        They've been taken off the shift and the date was added to their time off, so that shift may
        now be short-staffed — worth a look at the board to line up cover.
      </Text>
      <Button style={button} href={scheduleUrl}>
        Open the schedule
      </Button>
    </EmailLayout>
  );
}

ShiftUnableNotice.PreviewProps = {
  staffName: 'Sunny',
  shiftLabel: 'Evening',
  dateLabel: 'Thursday, August 14',
  timeLabel: '2:30p–8:30p',
  scheduleUrl: 'https://pyre-integrations.vercel.app/admin/schedule',
} satisfies ShiftUnableNoticeProps;

export default ShiftUnableNotice;
