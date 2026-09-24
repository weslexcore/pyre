-- Scheduling preferences move off /admin/users and onto the schedule's Hours
-- tab (/admin/schedule/hours), where each person sets their own and schedule
-- managers (schedule:manage or admin) set anyone's, via
-- /api/admin/staff-preferences. /admin/users keeps pay, roles, and page
-- access only.
--
-- Visibility changes with it: these four columns used to be redacted like
-- pay_rate (admin or owner only). They're now visible to schedule managers
-- too, since that's who plans around them. pay_rate stays admin-or-owner.
-- The redaction is server-side (redactPay in schedule-board.ts); app access
-- is service-role, and the existing admin-only select policy on staff is
-- unchanged.
--
-- Edits are logged to the schedule change log under a new 'staff_prefs'
-- entity (action 'update'), so /admin/schedule/changes shows who changed
-- whose preferences.

comment on column public.staff.target_hours_per_week is
  'Desired scheduled hours/week, set on /admin/schedule/hours by the person or a schedule manager. Null = no target. Drives the Insights consistency flags. Visible to the owner and schedule managers.';
comment on column public.staff.min_shifts_per_week is
  'Fewest shifts/week this person needs, set on /admin/schedule/hours by the person or a schedule manager. Null = no minimum. The AI drafter tries to reach it. Visible to the owner and schedule managers.';
comment on column public.staff.preferred_shifts_per_week is
  'Shifts/week this person would like, set on /admin/schedule/hours by the person or a schedule manager. Null = no preference. The AI drafter aims for it. Visible to the owner and schedule managers.';
comment on column public.staff.max_shifts_per_week is
  'Most shifts/week this person will take, set on /admin/schedule/hours by the person or a schedule manager. Null = no cap. Hard limit for AI drafts (/api/agent/proposals); managers may exceed it by hand. Visible to the owner and schedule managers.';

alter table public.schedule_changes
  drop constraint schedule_changes_entity_type_check;
alter table public.schedule_changes
  add constraint schedule_changes_entity_type_check
    check (
      entity_type in (
        'shift', 'assignment', 'time_off', 'proposal', 'sync', 'request',
        'sub_request', 'agent_instructions', 'staff_prefs'
      )
    );
