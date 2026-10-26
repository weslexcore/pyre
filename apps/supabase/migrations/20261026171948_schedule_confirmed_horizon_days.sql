-- Make the schedule's commitment horizon configurable.
--
-- Every Monday the staff schedule locks a run of days counted from that
-- Monday ("set in stone"); everything after is tentative. That length was
-- hardcoded to 14 days (this week plus next) in @pyre/schedule-core's
-- horizon.ts. Admins now set it from the board's Settings panel, stored as a
-- new day-count row in schedule_settings.

-- schedule_settings rows hold exactly one kind of value: an on/off switch
-- (enabled), a minute count (minutes), or now a day count (days).
alter table public.schedule_settings
  add column days integer check (days between 7 and 90);

comment on column public.schedule_settings.days is
  'Day-count settings (confirmed_horizon_days: days locked from each Monday); null for the switches and minute settings.';

alter table public.schedule_settings
  drop constraint schedule_settings_one_value_check;

alter table public.schedule_settings
  add constraint schedule_settings_one_value_check
    check (num_nonnulls(enabled, minutes, days) = 1);

-- Today's fixed value, so nothing changes until an admin changes it.
insert into public.schedule_settings (key, days) values
  ('confirmed_horizon_days', 14)
on conflict (key) do nothing;
