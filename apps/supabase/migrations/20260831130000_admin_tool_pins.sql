-- Per-user pinned tools on the /admin dashboard: a pinned tool shows in a
-- "Pinned" section at the top of the directory (and a Pinned group in the nav
-- menu), ordered by sort_order. One row per (person, tool); the client always
-- writes its complete pin list, so unpinning deletes the row and positions
-- self-normalize. The email comes from the Momence session, matching the
-- staff-table convention used everywhere else. tool_href has no foreign key:
-- the tool directory is defined in code (adminTools.ts), not in a table.

create table public.admin_tool_pins (
  user_email text not null check (char_length(user_email) between 3 and 320),
  tool_href text not null check (tool_href like '/admin/%' and char_length(tool_href) <= 200),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_email, tool_href)
);

alter table public.admin_tool_pins enable row level security;

-- App access is service-role (bypasses RLS); forward-looking convention like
-- sop_pins. Update is included because reordering rewrites sort_order in place.
create policy "admins can select admin tool pins"
  on public.admin_tool_pins for select
  using (public.is_admin());

create policy "admins can insert admin tool pins"
  on public.admin_tool_pins for insert
  with check (public.is_admin());

create policy "admins can update admin tool pins"
  on public.admin_tool_pins for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins can delete admin tool pins"
  on public.admin_tool_pins for delete
  using (public.is_admin());

comment on table public.admin_tool_pins is
  'Per-user pinned admin tools for the /admin dashboard (Pinned section + nav group). Keyed by session email + tool href; sort_order is the pin position.';
