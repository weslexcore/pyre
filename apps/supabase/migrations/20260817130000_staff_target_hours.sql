-- Target weekly hours, per person, for the Insights consistency view
-- (/admin/schedule/insights): some staff treat this as their main gig, others
-- as a supplement to another job — a per-person target lets the dashboard
-- compare actual scheduled hours against each person's own expectation
-- instead of one global threshold.
--
-- numeric(4,1): tenth-hour precision, capped at a week (168h). NULLABLE with
-- no default — null means "no target set"; those rows are never flagged. A
-- target of 0 is meaningless (clear to null instead), so the check demands a
-- positive value when present.
--
-- Visibility: matches pay_rate — not roster data. Redacted server-side from
-- every payload except the owner's own row and admin views (see redactPay in
-- schedule-board.ts). The existing admin-only select policy on staff already
-- covers the column at the RLS layer.
alter table public.staff
  add column if not exists target_hours_per_week numeric(4,1)
  constraint staff_target_hours_range check (
    target_hours_per_week is null
    or (target_hours_per_week > 0 and target_hours_per_week <= 168)
  );

comment on column public.staff.target_hours_per_week is
  'Desired scheduled hours/week, admin-set on /admin/users. Null = no target. Drives the Insights consistency flags. Redacted server-side like pay_rate: only the owner and admins receive it.';
