-- Shifts-per-week preferences, per person, alongside target_hours_per_week.
-- Hours alone don't say how someone wants their week shaped: 16h can be two
-- long shifts or four short ones, and people who work here as their main job
-- care about the number of shifts they get as much as the hours. Three
-- numbers, all admin-set on /admin/users:
--
--   min_shifts_per_week        the fewest shifts they need in a week
--   preferred_shifts_per_week  what the drafter aims for
--   max_shifts_per_week        a ceiling the AI drafter may not exceed
--                              (enforced in /api/agent/proposals; admins can
--                              still schedule past it by hand)
--
-- A "shift" is one assignment — a setup-only slot counts like a full one.
--
-- smallint, NULLABLE, no default: null means "no preference" for that bound.
-- Each is independent (a max alone is fine), but when two are set they must
-- be in order: min <= preferred <= max. 0 is a legal minimum (it's the same
-- as none) but not a legal preferred or max — clear those to null instead.
-- A week has 7 days and a person is on at most one shift per day in
-- practice, but doubles happen, so the ceiling is 14.
--
-- Visibility: same as target_hours_per_week — redacted server-side from
-- every payload except the owner's own row and admin views (redactPay in
-- schedule-board.ts). The existing admin-only select policy on staff covers
-- the columns at the RLS layer.
alter table public.staff
  add column if not exists min_shifts_per_week smallint
    constraint staff_min_shifts_range check (
      min_shifts_per_week is null
      or (min_shifts_per_week >= 0 and min_shifts_per_week <= 14)
    ),
  add column if not exists preferred_shifts_per_week smallint
    constraint staff_preferred_shifts_range check (
      preferred_shifts_per_week is null
      or (preferred_shifts_per_week >= 1 and preferred_shifts_per_week <= 14)
    ),
  add column if not exists max_shifts_per_week smallint
    constraint staff_max_shifts_range check (
      max_shifts_per_week is null
      or (max_shifts_per_week >= 1 and max_shifts_per_week <= 14)
    );

-- Ordering between whichever bounds are set. Null comparisons yield null,
-- which a check constraint treats as passing, so unset bounds never block.
alter table public.staff
  add constraint staff_shift_prefs_order check (
    min_shifts_per_week <= preferred_shifts_per_week
    and preferred_shifts_per_week <= max_shifts_per_week
    and min_shifts_per_week <= max_shifts_per_week
  );

comment on column public.staff.min_shifts_per_week is
  'Fewest shifts/week this person needs, admin-set on /admin/users. Null = no minimum. The AI drafter tries to reach it. Redacted like pay_rate.';
comment on column public.staff.preferred_shifts_per_week is
  'Shifts/week this person would like, admin-set on /admin/users. Null = no preference. The AI drafter aims for it. Redacted like pay_rate.';
comment on column public.staff.max_shifts_per_week is
  'Most shifts/week this person will take, admin-set on /admin/users. Null = no cap. Hard limit for AI drafts (/api/agent/proposals); admins may exceed it by hand. Redacted like pay_rate.';
