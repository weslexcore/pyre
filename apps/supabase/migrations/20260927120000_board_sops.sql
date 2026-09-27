-- SOPs linked to boards.
--
-- A board is where the work sits; an SOP is how the work is done. The
-- rentals pipeline wants its rentals and group-booking procedures a click
-- away, and each of those procedures wants a way back to the board it
-- feeds. The link is many-to-many: one board can carry several SOPs, and
-- one SOP can serve several boards.
--
-- A link is only a pointer. Who may follow it is still each side's own
-- rule — the board shows only the SOPs its viewer may read, and the SOP
-- only the boards its reader may open — so linking never widens access.
-- Deleting either side takes its links with it.

create table public.board_sops (
  board_id uuid not null references public.boards (id) on delete cascade,
  sop_id uuid not null references public.sops (id) on delete cascade,
  sort_order integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  primary key (board_id, sop_id)
);

comment on table public.board_sops is
  'Links between boards and the SOPs that describe their work. Many-to-many; managed from board settings, shown on both the board and the SOP.';
comment on column public.board_sops.sort_order is
  'Position of the SOP in the board''s list; the SOP side lists its boards by name.';

-- The primary key serves the board side; this serves the SOP page.
create index board_sops_sop_idx on public.board_sops (sop_id);

alter table public.board_sops enable row level security;

-- Every read and write goes through the admin API on the service role;
-- these policies only matter to a signed-in admin reaching the table directly.
create policy "admins can select board sops" on public.board_sops
  for select using (public.is_admin());
create policy "admins can insert board sops" on public.board_sops
  for insert with check (public.is_admin());
create policy "admins can update board sops" on public.board_sops
  for update using (public.is_admin()) with check (public.is_admin());
create policy "admins can delete board sops" on public.board_sops
  for delete using (public.is_admin());

grant all on table public.board_sops to service_role;
