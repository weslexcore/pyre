-- Hourly pay rate, per person, for the hours report's "amount due" math
-- (scheduled hours × rate on /admin/schedule/hours). Replaces the $20/hr
-- constant previously hardcoded in the dashboard UI.
--
-- numeric(6,2): dollars-and-cents, capped below $10k/hr, never float. Non-null
-- with a default of 20 (the shop rate) so every existing and future row prices
-- without a backfill thought.
--
-- Founders draw no hourly wage today, so their rows are seeded to 0; founders
-- added later get 0 from the users API at insert time. Admins edit rates
-- individually from /admin/users.
--
-- Visibility: like calendar_token, this is not roster data — the API redacts
-- it server-side from every payload except the owner's own row and admin
-- views (see schedule-board.ts). The existing admin-only select policy on
-- staff already covers the column at the RLS layer.
alter table public.staff
  add column if not exists pay_rate numeric(6,2) not null default 20
  constraint staff_pay_rate_nonnegative check (pay_rate >= 0);

update public.staff set pay_rate = 0 where is_founder;

comment on column public.staff.pay_rate is
  'Hourly wage in dollars. Default 20; founders seeded to 0 (no wage drawn). Drives the hours report''s amount-due column. Redacted server-side: only the owner and admins ever receive it.';
