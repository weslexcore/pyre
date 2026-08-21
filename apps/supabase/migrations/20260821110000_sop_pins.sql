-- Per-user SOP pins: a pinned document shows in a "Pinned" strip at the top
-- of /admin/sops for quick access. One row per (person, document); unpinning
-- deletes the row. The email comes from the Momence session, matching the
-- staff-table convention used everywhere else in the SOP tool.

create table public.sop_pins (
  user_email text not null check (char_length(user_email) between 3 and 320),
  sop_id uuid not null references public.sops (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_email, sop_id)
);

alter table public.sop_pins enable row level security;

-- App access is service-role (bypasses RLS); forward-looking convention like
-- the other sops tables.
create policy "admins can select sop pins"
  on public.sop_pins for select
  using (public.is_admin());

create policy "admins can insert sop pins"
  on public.sop_pins for insert
  with check (public.is_admin());

create policy "admins can delete sop pins"
  on public.sop_pins for delete
  using (public.is_admin());

comment on table public.sop_pins is
  'Per-user pinned SOPs for the /admin/sops library (pinned strip at the top). Keyed by session email + document.';
