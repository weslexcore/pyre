import { Button, Hr, Link, Text } from '@react-email/components';
import { button, COLORS, EmailLayout, heading, text } from '../components/EmailLayout';
import type { WeeklyShiftItem, WeeklyShiftsProps } from '../types';

// Monday morning to each person with live (non-draft) assignments in the week
// ahead — their own hours, not the whole board. Every row is a deep link to
// that shift on /admin/schedule, so "when am I working Thursday?" is one tap
// from the inbox. Sent by the weekly-shifts cron job.

const shiftDay = {
  ...text,
  color: COLORS.creme,
  fontSize: '15px',
  fontWeight: 700,
  lineHeight: '22px',
  margin: '0 0 2px',
};

const shiftDetail = {
  ...text,
  fontSize: '14px',
  lineHeight: '21px',
  margin: '0 0 2px',
};

const shiftNote = {
  ...shiftDetail,
  color: COLORS.sky,
  fontSize: '13px',
};

// The duties they hold on the shift — sage, the same colour the board marks
// them in, and set apart from the shift's own notes.
const shiftDuties = {
  ...shiftDetail,
  color: COLORS.sage,
  fontSize: '13px',
};

const shiftLink = {
  color: COLORS.creme,
  textDecoration: 'underline',
};

function ShiftRow({ shift }: { shift: WeeklyShiftItem }) {
  return (
    <>
      <Text style={shiftDay}>
        <Link href={shift.shiftUrl} style={shiftLink}>
          {shift.dayLabel} — {shift.timeLabel}
        </Link>
      </Text>
      <Text style={shiftDetail}>
        {shift.shiftLabel}
        {shift.roleLabel ? ` (${shift.roleLabel})` : ''}
      </Text>
      {shift.dutiesLabel ? <Text style={shiftDuties}>{shift.dutiesLabel}</Text> : null}
      {shift.notes ? <Text style={shiftNote}>{shift.notes}</Text> : null}
      {shift.subRequested ? (
        <Text style={shiftNote}>Sub requested — yours until someone claims it.</Text>
      ) : null}
    </>
  );
}

export function WeeklyShifts({
  firstName,
  weekLabel,
  shifts,
  totalHours,
  scheduleUrl,
}: WeeklyShiftsProps) {
  const shiftCount = shifts.length;
  return (
    <EmailLayout
      preview={`${shiftCount} shift${shiftCount === 1 ? '' : 's'} this week (${weekLabel})`}
    >
      <Text style={heading}>Your week, {firstName}</Text>
      <Text style={text}>
        {shiftCount === 1 ? "You're on 1 shift" : `You're on ${shiftCount} shifts`} for {weekLabel}{' '}
        — {totalHours} hours total. Tap any shift to open it on the schedule board.
      </Text>

      <Hr style={{ borderColor: COLORS.sky, margin: '4px 0 16px' }} />
      {shifts.map((shift, i) => (
        <div key={shift.shiftUrl} style={{ margin: i === 0 ? '0 0 14px' : '14px 0' }}>
          <ShiftRow shift={shift} />
        </div>
      ))}
      <Hr style={{ borderColor: COLORS.sky, margin: '16px 0 20px' }} />

      <Button style={button} href={scheduleUrl}>
        See the full schedule
      </Button>
      <Text style={text}>
        Need a change? Request a sub from the shift on the board and whoever's free that day gets
        asked automatically.
      </Text>
    </EmailLayout>
  );
}

WeeklyShifts.PreviewProps = {
  firstName: 'Omar',
  weekLabel: 'Aug 17–23',
  totalHours: '18.5',
  shifts: [
    {
      dayLabel: 'Mon, Aug 17',
      shiftLabel: 'Evening',
      timeLabel: '2:30p–8:30p',
      shiftUrl:
        'https://pyre-integrations.vercel.app/admin/schedule?view=week&date=2026-08-17&shift=example-1',
    },
    {
      dayLabel: 'Thu, Aug 20',
      shiftLabel: 'Morning',
      timeLabel: '8a–10a',
      roleLabel: 'setup',
      dutiesLabel: 'Setup · Break Down (A)',
      notes: 'Private event — 20 guests',
      shiftUrl:
        'https://pyre-integrations.vercel.app/admin/schedule?view=week&date=2026-08-20&shift=example-2',
    },
    {
      dayLabel: 'Sat, Aug 22',
      shiftLabel: 'Day',
      timeLabel: '10a–3p',
      subRequested: true,
      shiftUrl:
        'https://pyre-integrations.vercel.app/admin/schedule?view=week&date=2026-08-22&shift=example-3',
    },
  ],
  scheduleUrl: 'https://pyre-integrations.vercel.app/admin/schedule',
} satisfies WeeklyShiftsProps;

export default WeeklyShifts;
