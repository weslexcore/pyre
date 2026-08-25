-- Shift-request upgrades for /admin/schedule:
--   1. requested_starts_at / requested_ends_at — the hours the employee asks
--      to work, entered with the request. Null on rows created before this
--      migration; approval then falls back to the role-derived window (the
--      whole shift, or its setup span), same as before.
--   2. decision_note — an optional reason the manager attaches when approving
--      or denying; included in the decision email to the requester.

alter table public.shift_requests
  add column requested_starts_at time,
  add column requested_ends_at time,
  add column decision_note text;

-- The window is a pair: both sides set (new requests) or both null (legacy
-- rows), and it must run forward.
alter table public.shift_requests
  add constraint shift_requests_window_pair
    check ((requested_starts_at is null) = (requested_ends_at is null)),
  add constraint shift_requests_window_order
    check (requested_ends_at is null or requested_ends_at > requested_starts_at);
