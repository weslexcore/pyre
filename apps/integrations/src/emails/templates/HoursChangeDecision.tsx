import { Button, Text } from '@react-email/components';
import { button, EmailLayout, heading, text } from '../components/EmailLayout';
import type { HoursChangeDecisionProps } from '../types';

// To the employee when a manager decides their ask to change their own hours
// on a shift (staying late, coming in early). Approval means the schedule —
// and the hours report — now carries the new times; denial leaves the hours
// they were already on.

export function HoursChangeDecision({
  firstName,
  decision,
  shiftLabel,
  dateLabel,
  fromTimeLabel,
  timeLabel,
  reasonNote,
  scheduleUrl,
}: HoursChangeDecisionProps) {
  const approved = decision === 'approved';
  return (
    <EmailLayout
      preview={
        approved
          ? `Hours updated: ${shiftLabel} on ${dateLabel}, ${timeLabel}`
          : `Your hours change for ${shiftLabel} on ${dateLabel} wasn't approved`
      }
    >
      <Text style={heading}>
        {approved ? 'Your hours were updated' : 'Hours change not approved'}
      </Text>
      <Text style={text}>
        {approved
          ? `Hi ${firstName} — your change to ${shiftLabel} on ${dateLabel} was approved. You're now on for ${timeLabel} (was ${fromTimeLabel}).`
          : `Hi ${firstName} — your request to change ${shiftLabel} on ${dateLabel} to ${timeLabel} wasn't approved. Your hours stay ${fromTimeLabel}.`}
      </Text>
      {reasonNote && (
        <Text style={text}>
          {approved ? 'Note from the manager' : 'Reason'}: {reasonNote}
        </Text>
      )}
      <Button style={button} href={scheduleUrl}>
        Open the schedule
      </Button>
    </EmailLayout>
  );
}

HoursChangeDecision.PreviewProps = {
  firstName: 'Sunny',
  decision: 'approved',
  shiftLabel: 'Evening',
  dateLabel: 'Thursday, August 14',
  fromTimeLabel: '2:30p–8:30p',
  timeLabel: '2:30p–9:30p',
  scheduleUrl: 'https://pyre-integrations.vercel.app/admin/schedule',
} satisfies HoursChangeDecisionProps;

export default HoursChangeDecision;
