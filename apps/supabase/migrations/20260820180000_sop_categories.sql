-- Explicit ordering for SOP categories (the section headers on /admin/sops).
-- Categories on sops rows are free text; without this table the index page
-- could only sort them alphabetically, which put "Closing" before "Opening".
-- One row per category name with a sort position, upserted by the admin
-- reorder controls (/api/admin/sop-order). A category with no row here sorts
-- after all ranked ones, alphabetically — so ad-hoc categories created from
-- the SOP settings panel appear at the end until an admin places them.

create table public.sop_categories (
  -- The literal sops.category value (no FK — it's free text by design).
  name text primary key check (char_length(name) between 1 and 60),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger sop_categories_set_updated_at
  before update on public.sop_categories
  for each row execute function public.set_updated_at();

alter table public.sop_categories enable row level security;

-- App access is service-role (bypasses RLS); forward-looking convention like
-- the sops tables.
create policy "admins can select sop categories"
  on public.sop_categories for select
  using (public.is_admin());

create policy "admins can insert sop categories"
  on public.sop_categories for insert
  with check (public.is_admin());

create policy "admins can update sop categories"
  on public.sop_categories for update
  using (public.is_admin());

create policy "admins can delete sop categories"
  on public.sop_categories for delete
  using (public.is_admin());

comment on table public.sop_categories is
  'Display order for SOP categories on /admin/sops. Names match sops.category free text; unranked categories sort last alphabetically.';

-- The day starts with set-up: Opening before Closing.
insert into public.sop_categories (name, sort_order)
values ('Opening', 0), ('Closing', 1);
