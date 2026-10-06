-- Saved views of a board: its cards grouped by something other than the
-- column they sit in.
--
-- The columns say where a card is in the work. They do not answer the
-- questions the boards get asked most: which events are on in November,
-- which practitioner runs which events, which rentals are booked for next
-- month. Those are answers already on the cards, in their fields; a view
-- groups by one of them.
--
--   * group_by          — a built-in (column, assignee, due_date,
--                          created_at) or 'field', with group_field_key
--                          naming board_fields.key (permanent per board).
--   * date_unit         — how a date groups: day, week, month, or year.
--                          Only for a date (the app checks the field kind).
--   * layout            — stacked sections, or lanes like the columns.
--   * sort_by           — the order within a group: manual (the card's
--                          sort_order), due_date, title, created_at, or
--                          field:<key> for a date or number field.
--   * hide_finished     — leave out cards in done and dropped columns.
--   * show_empty        — list groups with no cards in them, where the
--                          groups are known ahead (options, columns).
--
-- Views belong to the board, not to a person: anyone who can open the board
-- can make, change, and remove them, and everyone sees the same list. A view
-- whose field is later deleted stays, and says its field is gone.

create table public.board_views (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0 and char_length(name) <= 40),
  group_by text not null
    check (group_by in ('column', 'assignee', 'due_date', 'created_at', 'field')),
  group_field_key text check (group_field_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  date_unit text check (date_unit in ('day', 'week', 'month', 'year')),
  layout text not null default 'sections' check (layout in ('sections', 'lanes')),
  sort_by text not null default 'manual' check (char_length(sort_by) <= 60),
  hide_finished boolean not null default true,
  show_empty boolean not null default false,
  sort_order integer not null default 0,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A field grouping names its field; a built-in names none.
  constraint board_views_field_whole
    check ((group_by = 'field') = (group_field_key is not null))
);

create index board_views_board_idx on public.board_views (board_id, sort_order);

create trigger board_views_set_updated_at
  before update on public.board_views
  for each row execute function public.set_updated_at();

comment on table public.board_views is
  'Saved views of a board: its cards grouped by a column, assignee, date, or field. Shared by everyone who can open the board.';
comment on column public.board_views.group_field_key is
  'board_fields.key of the field the view groups by, when group_by = field. Left in place if the field is deleted; the view says so.';
comment on column public.board_views.date_unit is
  'day, week, month, or year: how a date grouping buckets its cards. Null for a grouping that is not a date.';
comment on column public.board_views.sort_by is
  'Order within a group: manual, due_date, title, created_at, or field:<key> naming a date or number field.';

alter table public.board_views enable row level security;

-- Every read and write goes through the admin API on the service role;
-- these policies only matter to a signed-in admin reaching the table directly.
create policy "admins can select board views" on public.board_views
  for select using (public.is_admin());
create policy "admins can insert board views" on public.board_views
  for insert with check (public.is_admin());
create policy "admins can update board views" on public.board_views
  for update using (public.is_admin()) with check (public.is_admin());
create policy "admins can delete board views" on public.board_views
  for delete using (public.is_admin());

grant all on table public.board_views to service_role;
