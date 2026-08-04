-- One-off import of the "Pyre Staffing Schedule" sheet (as of 2026-08-04) so
-- the app launches with the current schedule and history. Generated from the
-- xlsx; blank-person Shift Log rows (unfilled setup slots) were skipped, and
-- one duplicate Blackouts row (Brian 8/16) was deduped.

-- Shifts (from "Shift Slots")
insert into public.shifts (shift_date, label, starts_at, ends_at, staff_needed, source, notes) values
  ('2026-07-08', 'Evening', '15:00', '20:30', 2, 'manual', null),
  ('2026-07-09', 'Evening', '15:00', '20:30', 2, 'manual', null),
  ('2026-07-10', 'Evening', '14:00', '22:00', 2, 'manual', 'Bachelorette @ 3p'),
  ('2026-07-11', 'Day', '09:00', '16:30', 2, 'manual', null),
  ('2026-07-12', 'Afternoon', '12:00', '16:30', 2, 'manual', null),
  ('2026-07-15', 'Evening', '15:00', '20:30', 2, 'manual', null),
  ('2026-07-19', 'Afternoon', '12:00', '16:30', 2, 'manual', null),
  ('2026-07-22', 'Evening', '15:00', '20:30', 2, 'manual', null),
  ('2026-07-23', 'Evening', '15:00', '20:30', 2, 'manual', 'Confirmed fine with Althea'),
  ('2026-07-24', 'Evening', '15:00', '21:30', 2, 'manual', null),
  ('2026-07-25', 'Day', '09:00', '16:30', 2, 'manual', 'Julien work before beach'),
  ('2026-07-26', 'Afternoon', '12:00', '16:30', 2, 'manual', null),
  ('2026-07-29', 'Evening', '14:30', '20:30', 2, 'manual', null),
  ('2026-07-30', 'Evening', '14:30', '20:30', 2, 'manual', null),
  ('2026-07-31', 'Evening', '14:30', '21:30', 2, 'manual', 'Althea confirmed'),
  ('2026-08-01', 'Day', '08:30', '16:30', 2, 'manual', null),
  ('2026-08-02', 'Afternoon', '11:30', '16:30', 2, 'manual', null),
  ('2026-08-05', 'Evening', '14:30', '20:30', 2, 'manual', null),
  ('2026-08-06', 'Evening', '14:30', '20:30', 2, 'manual', 'Sarah Setup'),
  ('2026-08-07', 'Evening', '14:30', '21:30', 2, 'manual', null),
  ('2026-08-08', 'Day', '08:30', '16:30', 2, 'manual', null),
  ('2026-08-09', 'Afternoon', '11:30', '16:30', 2, 'manual', null),
  ('2026-08-10', 'Afternoon', '13:30', '15:30', 2, 'manual', 'Riffs and Recovery'),
  ('2026-08-12', 'Evening', '14:30', '20:30', 2, 'manual', null),
  ('2026-08-13', 'Morning', '05:30', '10:30', 2, 'manual', null),
  ('2026-08-13', 'Evening', '14:30', '20:30', 2, 'manual', 'Sarah Setup'),
  ('2026-08-14', 'Morning', '05:30', '10:30', 2, 'manual', null),
  ('2026-08-14', 'Evening', '14:30', '21:30', 2, 'manual', null),
  ('2026-08-15', 'Day', '08:30', '16:30', 2, 'manual', null),
  ('2026-08-16', 'Afternoon', '11:30', '16:30', 2, 'manual', null);

-- Assignments (from "Shift Log"), matched to their shift by date + overlap.
with log(shift_date, person, starts_at, ends_at, role, notes) as (
  values
    ('2026-07-08'::date, 'Wes', '15:00'::time, '20:30'::time, 'full', null),
    ('2026-07-08'::date, 'Julien', '15:00'::time, '16:00'::time, 'setup', null),
    ('2026-07-09'::date, 'Julien', '15:00'::time, '20:00'::time, 'full', null),
    ('2026-07-09'::date, 'Omar', '15:00'::time, '16:00'::time, 'setup', null),
    ('2026-07-10'::date, 'Wes', '14:00'::time, '22:00'::time, 'full', 'Bachelorette @ 3p'),
    ('2026-07-10'::date, 'Omar', '14:00'::time, '22:00'::time, 'full', 'Bachelorette @ 3p'),
    ('2026-07-11'::date, 'Julien', '09:00'::time, '16:30'::time, 'full', null),
    ('2026-07-11'::date, 'Althea', '09:00'::time, '10:00'::time, 'setup', null),
    ('2026-07-12'::date, 'Wes', '12:00'::time, '16:30'::time, 'full', null),
    ('2026-07-15'::date, 'Wes', '15:00'::time, '20:30'::time, 'full', null),
    ('2026-07-15'::date, 'Julien', '15:00'::time, '16:00'::time, 'setup', null),
    ('2026-07-19'::date, 'Julien', '12:00'::time, '16:30'::time, 'full', null),
    ('2026-07-19'::date, 'Brian', '12:00'::time, '14:00'::time, 'partial', null),
    ('2026-07-22'::date, 'Wes', '15:00'::time, '20:30'::time, 'full', null),
    ('2026-07-22'::date, 'Sarah', '15:00'::time, '18:30'::time, 'full', null),
    ('2026-07-22'::date, 'Omar', '15:00'::time, '16:30'::time, 'setup', null),
    ('2026-07-23'::date, 'Julien', '15:00'::time, '20:30'::time, 'full', null),
    ('2026-07-23'::date, 'Sunny', '15:00'::time, '16:30'::time, 'setup', null),
    ('2026-07-23'::date, 'Althea', '15:00'::time, '16:30'::time, 'setup', null),
    ('2026-07-24'::date, 'Wes', '15:00'::time, '21:30'::time, 'full', null),
    ('2026-07-24'::date, 'Omar', '15:00'::time, '17:30'::time, 'full', null),
    ('2026-07-24'::date, 'Sarah', '15:00'::time, '16:30'::time, 'partial', null),
    ('2026-07-25'::date, 'Julien', '09:00'::time, '16:30'::time, 'full', null),
    ('2026-07-25'::date, 'Sarah', '09:00'::time, '12:00'::time, 'partial', null),
    ('2026-07-25'::date, 'Brian', '09:00'::time, '10:30'::time, 'setup', null),
    ('2026-07-26'::date, 'Wes', '12:00'::time, '16:30'::time, 'full', null),
    ('2026-07-26'::date, 'Sunny', '12:00'::time, '16:30'::time, 'full', null),
    ('2026-07-29'::date, 'Wes', '14:30'::time, '20:30'::time, 'full', null),
    ('2026-07-29'::date, 'Sunny', '14:30'::time, '16:00'::time, 'setup', null),
    ('2026-07-29'::date, 'Sarah', '14:30'::time, '16:00'::time, 'setup', null),
    ('2026-07-30'::date, 'Wes', '14:30'::time, '20:30'::time, 'full', null),
    ('2026-07-30'::date, 'Sunny', '14:30'::time, '16:00'::time, 'setup', null),
    ('2026-07-30'::date, 'Omar', '14:30'::time, '16:00'::time, 'setup', null),
    ('2026-07-31'::date, 'Julien', '14:30'::time, '21:30'::time, 'full', null),
    ('2026-07-31'::date, 'Althea', '14:30'::time, '21:30'::time, 'full', null),
    ('2026-07-31'::date, 'Sarah', '14:30'::time, '16:30'::time, 'setup', null),
    ('2026-08-01'::date, 'Julien', '09:00'::time, '16:30'::time, 'full', null),
    ('2026-08-01'::date, 'Sarah', '09:00'::time, '10:30'::time, 'setup', null),
    ('2026-08-01'::date, 'Althea', '09:00'::time, '10:30'::time, 'setup', null),
    ('2026-08-02'::date, 'Wes', '11:30'::time, '16:30'::time, 'full', null),
    ('2026-08-02'::date, 'Sunny', '12:00'::time, '16:30'::time, 'full', null),
    ('2026-08-05'::date, 'Wes', '15:00'::time, '20:30'::time, 'full', null),
    ('2026-08-05'::date, 'Sarah', '15:00'::time, '20:30'::time, 'full', null),
    ('2026-08-05'::date, 'Sunny', '15:00'::time, '16:00'::time, 'setup', null),
    ('2026-08-06'::date, 'Wes', '15:00'::time, '20:30'::time, 'full', null),
    ('2026-08-06'::date, 'Omar', '15:00'::time, '20:30'::time, 'full', null),
    ('2026-08-06'::date, 'Sarah', '14:30'::time, '16:00'::time, 'setup', null),
    ('2026-08-07'::date, 'Julien', '15:00'::time, '21:30'::time, 'full', null),
    ('2026-08-07'::date, 'Sarah', '15:00'::time, '21:30'::time, 'full', null),
    ('2026-08-08'::date, 'Julien', '09:00'::time, '16:30'::time, 'full', null),
    ('2026-08-08'::date, 'Omar', '09:00'::time, '10:00'::time, 'setup', null),
    ('2026-08-09'::date, 'Julien', '12:00'::time, '16:30'::time, 'full', null),
    ('2026-08-09'::date, 'Sunny', '12:00'::time, '16:30'::time, 'full', null),
    ('2026-08-10'::date, 'Wes', '13:30'::time, '15:30'::time, 'full', null),
    ('2026-08-10'::date, 'Julien', '13:30'::time, '15:30'::time, 'full', null),
    ('2026-08-12'::date, 'Wes', '14:30'::time, '20:30'::time, 'full', null),
    ('2026-08-12'::date, 'Sarah', '14:30'::time, '20:30'::time, 'full', null),
    ('2026-08-13'::date, 'Julien', '14:30'::time, '20:30'::time, 'full', null),
    ('2026-08-13'::date, 'Sunny', '14:30'::time, '20:30'::time, 'full', null),
    ('2026-08-13'::date, 'Sarah', '14:30'::time, '16:30'::time, 'setup', null),
    ('2026-08-14'::date, 'Wes', '14:30'::time, '21:30'::time, 'full', null),
    ('2026-08-14'::date, 'Sarah', '14:30'::time, '21:30'::time, 'full', null),
    ('2026-08-15'::date, 'Julien', '08:30'::time, '16:30'::time, 'full', null),
    ('2026-08-15'::date, 'Althea', '08:30'::time, '16:30'::time, 'full', null),
    ('2026-08-16'::date, 'Wes', '11:30'::time, '16:30'::time, 'full', null),
    ('2026-08-16'::date, 'Sunny', '11:30'::time, '16:30'::time, 'full', null)
)
insert into public.shift_assignments (shift_id, staff_id, starts_at, ends_at, role, notes)
select s.id, st.id, log.starts_at, log.ends_at, log.role, log.notes
from log
join public.shifts s
  on s.shift_date = log.shift_date
  and log.starts_at < s.ends_at and log.ends_at > s.starts_at
join public.schedule_staff st on st.display_name = log.person;

-- Unavailability (from "Blackouts")
insert into public.time_off (staff_id, kind, start_date, end_date, days_of_week, starts_at, ends_at, note, created_by)
select st.id, b.kind, b.start_date, b.end_date, b.days_of_week, b.starts_at, b.ends_at, b.note, 'admin'
from (values
  ('Omar', 'recurring', null::date, null::date, '{0}'::smallint[], null::time, null::time, 'Recurring - no Sundays (Jul–Aug)'),
  ('Sunny', 'recurring', '2026-08-18'::date, '2026-12-07'::date, '{1,3,5}'::smallint[], '00:00'::time, '12:00'::time, 'Aug - Dec'),
  ('Sarah', 'recurring', '2026-08-06'::date, '2026-11-22'::date, '{4}'::smallint[], '17:30'::time, '21:00'::time, null),
  ('Sarah', 'recurring', '2026-08-06'::date, '2026-11-22'::date, '{6}'::smallint[], '10:30'::time, '19:30'::time, null),
  ('Sarah', 'recurring', '2026-08-06'::date, '2026-11-22'::date, '{0}'::smallint[], '11:30'::time, '17:00'::time, null),
  ('Althea', 'recurring', null::date, null::date, '{1,2,3,4}'::smallint[], '00:00'::time, '17:00'::time, null),
  ('Althea', 'recurring', null::date, null::date, '{5}'::smallint[], '00:00'::time, '15:00'::time, null),
  ('Sunny', 'range', '2026-07-22'::date, '2026-07-22'::date, '{}'::smallint[], null::time, null::time, 'Concert'),
  ('Julien', 'range', '2026-07-25'::date, '2026-07-30'::date, '{}'::smallint[], null::time, null::time, 'Traveling'),
  ('Brian', 'range', '2026-08-04'::date, '2026-08-08'::date, '{}'::smallint[], null::time, null::time, 'Work'),
  ('Althea', 'range', '2026-08-05'::date, '2026-08-09'::date, '{}'::smallint[], null::time, null::time, 'Traveling'),
  ('Wes', 'range', '2026-08-07'::date, '2026-08-09'::date, '{}'::smallint[], null::time, null::time, 'Traveling'),
  ('Brian', 'range', '2026-08-10'::date, '2026-08-10'::date, '{}'::smallint[], null::time, null::time, null),
  ('Brian', 'range', '2026-08-14'::date, '2026-08-14'::date, '{}'::smallint[], null::time, null::time, null),
  ('Brian', 'range', '2026-08-16'::date, '2026-08-16'::date, '{}'::smallint[], null::time, null::time, null),
  ('Althea', 'range', '2026-08-16'::date, '2026-08-16'::date, '{}'::smallint[], null::time, null::time, 'Run / tattoo'),
  ('Brian', 'range', '2026-08-19'::date, '2026-08-19'::date, '{}'::smallint[], null::time, null::time, null),
  ('Julien', 'range', '2026-08-23'::date, '2026-09-07'::date, '{}'::smallint[], null::time, null::time, 'OOTO'),
  ('Brian', 'range', '2026-08-25'::date, '2026-08-31'::date, '{}'::smallint[], null::time, null::time, null),
  ('Althea', 'range', '2026-08-29'::date, '2026-08-29'::date, '{}'::smallint[], null::time, null::time, 'Marathon'),
  ('Omar', 'recurring', null::date, null::date, '{5}'::smallint[], '07:00'::time, '17:30'::time, null),
  ('Sunny', 'range', '2026-08-06'::date, '2026-08-08'::date, '{}'::smallint[], null::time, null::time, null)
) as b(person, kind, start_date, end_date, days_of_week, starts_at, ends_at, note)
join public.schedule_staff st on st.display_name = b.person;
