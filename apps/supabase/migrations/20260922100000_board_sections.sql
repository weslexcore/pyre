-- Sections on the boards index.
--
-- The SOP library groups its documents under named, ordered sections that
-- an admin can add, rename, and rearrange (sop_categories). Boards get the
-- same shelf: a board_sections row is a heading with a position, and a
-- board points at one. Unlike SOPs the link is a proper foreign key — a
-- rename is a one-row update and can never merge two sections by accident.
--
-- A board with no section sits under an unnamed group after every named
-- one. Deleting a section is refused by the route while boards point at it;
-- the on delete set null is the backstop, never the path.

create table public.board_sections (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) > 0 and char_length(name) <= 60),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.board_sections is
  'Named, ordered headings the boards index groups boards under. Admin-managed; boards point at them by section_id.';

create index board_sections_order_idx on public.board_sections (sort_order, name);

create trigger board_sections_set_updated_at
  before update on public.board_sections
  for each row execute function public.set_updated_at();

alter table public.board_sections enable row level security;

create policy "board_sections admin select" on public.board_sections
  for select using (public.is_admin());
create policy "board_sections admin insert" on public.board_sections
  for insert with check (public.is_admin());
create policy "board_sections admin update" on public.board_sections
  for update using (public.is_admin()) with check (public.is_admin());
create policy "board_sections admin delete" on public.board_sections
  for delete using (public.is_admin());

alter table public.boards
  add column section_id uuid references public.board_sections (id) on delete set null;

comment on column public.boards.section_id is
  'The heading this board sits under on the index; null for the unnamed group at the end.';

create index boards_section_idx on public.boards (section_id, archived, sort_order);
