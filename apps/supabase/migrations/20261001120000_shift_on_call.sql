-- An on-call person for each shift.
--
-- Every live shift names one person the crew rings when something goes wrong
-- that they can't handle on their own. For now that is one of the founders
-- (Julien or Wes); later it may widen to shift leads, so who can be on call
-- is a flag on the roster rather than a hard-coded list or a reuse of
-- is_founder.
--
-- The rule the board's "Auto on-call" action applies (packages/schedule-core
-- on-call.ts):
--   1. If an on-call person is working that day, they're on call — the one
--      on this very shift first, then anyone working another shift that day.
--   2. Otherwise on call is split evenly between the on-call people who
--      aren't on time off during the shift, counting the past four weeks so
--      the balance carries from week to week.
-- An admin can override any shift by hand; on_call_manual keeps the auto
-- action from overwriting that choice until it is handed back to the rule.

-- 1. Who may be on call -------------------------------------------------------

alter table public.staff
  add column on_call_eligible boolean not null default false;

comment on column public.staff.on_call_eligible is
  'May be named the on-call person for a shift (shifts.on_call_staff_id). Founders today; may widen to shift leads. Set on /admin/users.';

-- The founders are Julien and Wes — the only people on call today.
update public.staff set on_call_eligible = true where is_founder;

-- 2. Who is on call for each shift --------------------------------------------

alter table public.shifts
  -- on delete set null: removing a person leaves the shift without an on-call
  -- rather than blocking the delete; the board flags the gap.
  add column on_call_staff_id uuid references public.staff (id) on delete set null,
  -- true when an admin picked (or deliberately cleared) the on-call person by
  -- hand; the auto action leaves these shifts alone.
  add column on_call_manual boolean not null default false;

comment on column public.shifts.on_call_staff_id is
  'The person the crew calls for this shift. Filled by the board''s Auto on-call action (schedule-core on-call.ts) or set by hand. Null = nobody yet.';
comment on column public.shifts.on_call_manual is
  'Set when an admin chose the on-call person by hand (including choosing nobody); the Auto on-call action skips these shifts.';

create index shifts_on_call_staff_idx on public.shifts (on_call_staff_id)
  where on_call_staff_id is not null;

-- RLS: no new policies needed. Both columns sit on tables whose existing
-- admin-select policies already cover them, and app access is service-role,
-- gated in-route by requirePage / requireScheduleManage.
