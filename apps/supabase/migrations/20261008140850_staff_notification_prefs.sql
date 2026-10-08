-- Per-person notification preferences for the /admin inbox.
--
-- Until now every event that reached someone's inbox (staff_notifications)
-- was written for everyone the event concerned, with no way to say "I don't
-- need to hear about goal activity" short of dismissing each row. This adds
-- one row per person listing the kinds they have switched off. Delivery is
-- opt-out: no row (or an empty list) means every kind is on, so nobody stops
-- hearing about anything until they choose to.
--
-- The notifier (lib/notifications/notify) reads this before writing a fan-out
-- and drops the recipients who muted that kind. Muting only affects future
-- notifications; rows already in the inbox stay until read or dismissed.
-- Admin messages are always delivered — the app refuses to store that kind
-- here — since they are how the admins reach the team.
--
-- Keyed by the session email like admin_tool_pins and the other per-user
-- tables. muted_kinds has no check against the kind list: the kinds are
-- defined in code (lib/notifications/types) and the route validates them,
-- and a kind dropped later should not make old rows invalid.

create table public.staff_notification_prefs (
  -- Whose preferences (staff email, lowercased).
  user_email text primary key check (char_length(user_email) between 3 and 320),
  -- Notification kinds this person does not want in their inbox.
  muted_kinds text[] not null default '{}'
    check (coalesce(array_length(muted_kinds, 1), 0) <= 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger staff_notification_prefs_set_updated_at
  before update on public.staff_notification_prefs
  for each row execute function public.set_updated_at();

alter table public.staff_notification_prefs enable row level security;

-- App access is service-role (bypasses RLS); these are the admin-only
-- forward-looking convention the other admin tables follow.
create policy "admins can select staff notification prefs"
  on public.staff_notification_prefs for select
  using (public.is_admin());

create policy "admins can insert staff notification prefs"
  on public.staff_notification_prefs for insert
  with check (public.is_admin());

create policy "admins can update staff notification prefs"
  on public.staff_notification_prefs for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins can delete staff notification prefs"
  on public.staff_notification_prefs for delete
  using (public.is_admin());

comment on table public.staff_notification_prefs is
  'Per-person opt-outs for the /admin inbox: the notification kinds each person has switched off. No row means every kind is delivered.';
