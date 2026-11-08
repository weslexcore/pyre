import { Button, Hr, Link, Text } from '@react-email/components';
import { button, COLORS, EmailLayout, heading, text } from '../components/EmailLayout';
import type {
  WeeklyDutyItem,
  WeeklyShiftItem,
  WeeklyShiftsProps,
  WeeklyTimeOffItem,
  WeeklyTimeOffWindow,
} from '../types';

// Monday morning to each person with live (non-draft) assignments in the week
// ahead — their own hours, not the whole board. Every row is a deep link to
// that shift on /admin/schedule, so "when am I working Thursday?" is one tap
// from the inbox. Off-shift duties they're down for (fill the carboys
// Monday) follow the shifts, each a link to its day. Their time off closes
// the email in two windows — the dates the schedule is already set for, then
// the two weeks that get scheduled next — with a button to the Availability
// tab so anything missing gets logged before those weeks lock. Sent by the
// weekly-shifts cron job.

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

// Section lead-ins ("Off-shift duties", a time-off window's dates) — the
// shift-detail face, letterspaced so they read as labels rather than rows.
const sectionLabel = {
  ...shiftDetail,
  color: COLORS.sky,
  fontSize: '12px',
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase' as const,
  margin: '0 0 6px',
};

// The second call to action: outlined, so "See the full schedule" stays the
// one red button.
const secondaryButton = {
  ...button,
  backgroundColor: 'transparent',
  border: `1px solid ${COLORS.creme}`,
};

function ShiftRow({ shift }: { shift: WeeklyShiftItem }) {
  return (
    <>
      <Text style={shiftDay}>
        <Link href={shift.shiftUrl} style={shiftLink}>
          {shift.dayLabel} — {shift.timeLabel}
        </Link>
      </Text>
      <Text style={shiftDetail}>{shift.shiftLabel}</Text>
      {shift.dutiesLabel ? <Text style={shiftDuties}>{shift.dutiesLabel}</Text> : null}
      {shift.notes ? <Text style={shiftNote}>{shift.notes}</Text> : null}
      {shift.subRequested ? (
        <Text style={shiftNote}>Sub requested — yours until someone claims it.</Text>
      ) : null}
    </>
  );
}

function TimeOffRow({ item }: { item: WeeklyTimeOffItem }) {
  return (
    <>
      <Text style={shiftDay}>{item.whenLabel}</Text>
      <Text style={shiftDetail}>{item.timeLabel}</Text>
      {item.note ? <Text style={shiftNote}>{item.note}</Text> : null}
    </>
  );
}

function TimeOffWindowBlock({ title, window }: { title: string; window: WeeklyTimeOffWindow }) {
  return (
    <>
      <Text style={sectionLabel}>
        {title} · {window.rangeLabel}
      </Text>
      {window.items.length === 0 ? (
        <Text style={shiftDetail}>No time off logged.</Text>
      ) : (
        window.items.map((item, i) => (
          <div
            key={`${item.whenLabel}-${item.timeLabel}`}
            style={{ margin: i === 0 ? '0 0 10px' : '10px 0' }}
          >
            <TimeOffRow item={item} />
          </div>
        ))
      )}
    </>
  );
}

function DutyRow({ duty }: { duty: WeeklyDutyItem }) {
  return (
    <>
      <Text style={shiftDay}>
        <Link href={duty.dayUrl} style={shiftLink}>
          {duty.dayLabel} — {duty.dutyLabel}
        </Link>
      </Text>
      {duty.detail ? <Text style={shiftDuties}>{duty.detail}</Text> : null}
    </>
  );
}

export function WeeklyShifts({
  firstName,
  weekLabel,
  shifts,
  offShiftDuties = [],
  totalHours,
  scheduleUrl,
  timeOff,
  availabilityUrl,
}: WeeklyShiftsProps) {
  const shiftCount = shifts.length;
  const dutyCount = offShiftDuties.length;
  const dutiesPhrase = `${dutyCount} off-shift dut${dutyCount === 1 ? 'y' : 'ies'}`;
  return (
    <EmailLayout
      preview={
        shiftCount > 0
          ? `${shiftCount} shift${shiftCount === 1 ? '' : 's'} this week (${weekLabel})`
          : `${dutiesPhrase} this week (${weekLabel})`
      }
    >
      <Text style={heading}>Your week, {firstName}</Text>
      {shiftCount > 0 ? (
        <Text style={text}>
          {shiftCount === 1 ? "You're on 1 shift" : `You're on ${shiftCount} shifts`} for{' '}
          {weekLabel} — {totalHours} hours total
          {dutyCount > 0 ? `, plus ${dutiesPhrase}` : ''}. Tap any shift to open it on the schedule
          board.
        </Text>
      ) : (
        <Text style={text}>
          No shifts for {weekLabel}, but you're down for {dutiesPhrase}. Tap one to open its day on
          the schedule board.
        </Text>
      )}

      <Hr style={{ borderColor: COLORS.sky, margin: '4px 0 16px' }} />
      {shifts.map((shift, i) => (
        <div key={shift.shiftUrl} style={{ margin: i === 0 ? '0 0 14px' : '14px 0' }}>
          <ShiftRow shift={shift} />
        </div>
      ))}
      {dutyCount > 0 && (
        <>
          {shiftCount > 0 && <Hr style={{ borderColor: COLORS.sky, margin: '16px 0' }} />}
          <Text style={sectionLabel}>Off-shift duties</Text>
          {offShiftDuties.map((duty) => (
            <div key={`${duty.dayLabel}-${duty.dutyLabel}`} style={{ margin: '10px 0' }}>
              <DutyRow duty={duty} />
            </div>
          ))}
        </>
      )}
      <Hr style={{ borderColor: COLORS.sky, margin: '16px 0 20px' }} />

      <Button style={button} href={scheduleUrl}>
        See the full schedule
      </Button>
      <Text style={text}>
        Need a change? Request a sub from the shift on the board and whoever's free that day gets
        asked automatically.
      </Text>

      <Hr style={{ borderColor: COLORS.sky, margin: '4px 0 16px' }} />
      <Text style={{ ...heading, fontSize: '18px', lineHeight: '26px' }}>Your time off</Text>
      <div style={{ margin: '0 0 16px' }}>
        <TimeOffWindowBlock title="Schedule set" window={timeOff.confirmed} />
      </div>
      <TimeOffWindowBlock title="Scheduled next" window={timeOff.upcoming} />
      <Text style={{ ...text, margin: '16px 0' }}>
        The schedule for {timeOff.upcoming.rangeLabel} gets set next. If you'll be away any of those
        days and it isn't listed above, add it now so we plan around it.
      </Text>
      <Button style={secondaryButton} href={availabilityUrl}>
        Add time off
      </Button>
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
  offShiftDuties: [
    {
      dayLabel: 'Mon, Aug 17',
      dutyLabel: 'Fill Carboys',
      detail: 'Both carboys, from the back tap',
      dayUrl: 'https://pyre-integrations.vercel.app/admin/schedule?view=week&date=2026-08-17',
    },
  ],
  scheduleUrl: 'https://pyre-integrations.vercel.app/admin/schedule',
  timeOff: {
    confirmed: {
      rangeLabel: 'Aug 17–30',
      items: [
        { whenLabel: 'Fri, Aug 28 – Sun, Aug 30', timeLabel: 'All day', note: 'Wedding' },
        { whenLabel: 'Every Wed', timeLabel: '9a–12p', note: 'Class' },
      ],
    },
    upcoming: {
      rangeLabel: 'Aug 31–Sep 13',
      items: [{ whenLabel: 'Every Wed', timeLabel: '9a–12p', note: 'Class' }],
    },
  },
  availabilityUrl: 'https://pyre-integrations.vercel.app/admin/schedule/availability',
} satisfies WeeklyShiftsProps;

export default WeeklyShifts;
