-- Check Ins (/admin/guests/check-ins): checking a guest out.
--
-- Momence has no check-out, only the check-in flag, so leaving is recorded
-- here. A checked-out guest drops off the page's active list (no more
-- check-ins come due for them) and shows under "Checked out" with when they
-- came and went. Null = still in.

alter table public.guest_floor_checkins
  add column checked_out_at timestamptz,
  add column checked_out_by text,
  add constraint guest_floor_checkins_checkout_after_checkin
    check (checked_out_at is null or checked_out_at >= checked_in_at);

comment on column public.guest_floor_checkins.checked_out_at is
  'When staff checked the guest out on /admin/guests/check-ins; null = still in. Momence keeps no check-out.';
comment on column public.guest_floor_checkins.checked_out_by is
  'Who checked the guest out.';
