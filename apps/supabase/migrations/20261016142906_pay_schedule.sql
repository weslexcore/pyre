-- Paydays on the staff schedule.
--
-- 1. pay_schedule — one row saying when pay lands, set by an admin in the
--    schedule board's Settings panel (/api/admin/pay-schedule). The cadence is
--    every week or two from a known payday (anchor_date), or fixed days of
--    the month (days_of_month: two for semimonthly, one for monthly; 31 means
--    the last day). shift_rule says where a payday that lands on a weekend or
--    a Federal Reserve holiday moves to. The dates themselves are computed in
--    code (packages/schedule-core/src/payday.ts), never stored.
--
-- 2. staff.calendar_payday — each person's own choice of whether paydays show
--    up in their subscribed calendar feed (/api/schedule/feed.ics). Off until
--    they turn it on from the Subscribe panel on /admin/schedule/calendar.

-- 1. Pay schedule -------------------------------------------------------------

create table public.pay_schedule (
  -- Single-row table: the primary key can only ever be true.
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  frequency text not null
    check (frequency in ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  -- weekly / biweekly: any one nominal payday; the others step from it
  anchor_date date,
  -- semimonthly / monthly: days of the month, 1-31 (31 = last day)
  days_of_month smallint[] not null default '{}',
  -- a payday on a weekend or bank holiday moves to the business day before,
  -- after, or stays put
  shift_rule text not null default 'before'
    check (shift_rule in ('before', 'after', 'none')),
  -- dashboard email of the admin who last saved it
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pay_schedule_cadence_check check (
    case frequency
      when 'weekly' then anchor_date is not null
      when 'biweekly' then anchor_date is not null
      when 'semimonthly' then cardinality(days_of_month) = 2
      when 'monthly' then cardinality(days_of_month) = 1
    end
  ),
  constraint pay_schedule_days_check check (
    1 <= all (days_of_month) and 31 >= all (days_of_month)
  )
);

create trigger pay_schedule_set_updated_at
  before update on public.pay_schedule
  for each row execute function public.set_updated_at();

-- Today's schedule, the one the timesheet's pay periods already assume
-- (PAY_PERIOD_ANCHOR in packages/schedule-core/src/hours.ts): every other
-- Monday, from Monday 2026-08-17.
insert into public.pay_schedule (frequency, anchor_date, shift_rule)
values ('biweekly', '2026-08-17', 'before');

-- App access is service-role (bypasses RLS); the admin policies follow the
-- convention of the other scheduling tables.
alter table public.pay_schedule enable row level security;

create policy "admins can select the pay schedule"
  on public.pay_schedule for select
  using (public.is_admin());

create policy "admins can insert the pay schedule"
  on public.pay_schedule for insert
  with check (public.is_admin());

create policy "admins can update the pay schedule"
  on public.pay_schedule for update
  using (public.is_admin());

create policy "admins can delete the pay schedule"
  on public.pay_schedule for delete
  using (public.is_admin());

-- New tables don't inherit the service-role grants the app relies on.
grant select, insert, update, delete on public.pay_schedule to service_role;

comment on table public.pay_schedule is
  'When staff pay lands (single row), set from the schedule board''s Settings panel. Paydays are computed from it in packages/schedule-core/src/payday.ts and shown on the schedule and, for people who opt in, in their calendar feed.';

-- 2. Per-person calendar choice ----------------------------------------------

alter table public.staff
  add column calendar_payday boolean not null default false;

comment on column public.staff.calendar_payday is
  'Whether paydays appear as all-day events in this person''s subscribed calendar feed. Set by the person from the Subscribe panel on /admin/schedule/calendar.';
