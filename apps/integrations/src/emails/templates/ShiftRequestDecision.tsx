import { Button, Text } from '@react-email/components';
import { button, EmailLayout, heading, text } from '../components/EmailLayout';
import type { ShiftRequestDecisionProps } from '../types';

// To the employee when a manager decides their shift request. Approval means
// they're on the schedule with the role and window they asked for; denial
// just closes the ask — the shift was likely covered another way.

export function ShiftRequestDecision({
  firstName,
  decision,
  shiftLabel,
  dateLabel,
  timeLabel,
  roleLabel,
  reasonNote,
  scheduleUrl,
}: ShiftRequestDecisionProps) {
  const approved = decision === 'approved';
  return (
    <EmailLayout
      preview={
        approved
          ? `You're on: ${shiftLabel} on ${dateLabel}`
          : `Your ${shiftLabel} request on ${dateLabel} was closed`
      }
    >
      <Text style={heading}>{approved ? "You're on the schedule" : 'Shift request closed'}</Text>
      <Text style={text}>
        {approved
          ? `Hi ${firstName} — your request to work ${shiftLabel} on ${dateLabel} was approved. You're on for ${timeLabel} (${roleLabel}).`
          : `Hi ${firstName} — your request to work ${shiftLabel} on ${dateLabel} (${timeLabel}, ${roleLabel}) wasn't approved this time; the shift was likely covered another way. Keep an eye on the board for other open shifts.`}
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

ShiftRequestDecision.PreviewProps = {
  firstName: 'Sunny',
  decision: 'approved',
  shiftLabel: 'Evening',
  dateLabel: 'Thursday, August 14',
  timeLabel: '2:30p–8:30p',
  roleLabel: 'Full',
  scheduleUrl: 'https://pyre-integrations.vercel.app/admin/schedule',
} satisfies ShiftRequestDecisionProps;

export default ShiftRequestDecision;
