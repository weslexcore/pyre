-- One more shape a board field can take: a link to cards on another board.
--
-- An events board wants a Practitioner field whose answer is a practitioner
-- card, and only one from the columns that mean "we work with them"
-- (onboarded, active, inactive) — not a prospect. The practitioner card, in
-- turn, wants an Events field listing every event it was linked to, without
-- anybody typing that list a second time. The same shape answers a rental
-- lead's guest, a task's vendor, or a task "blocked by" another task on its
-- own board, so none of this knows the word "practitioner".
--
--   * board_fields.link_board_id         — the board whose cards answer it.
--   * board_fields.link_columns          — keys of that board's columns a
--                                          card may be *picked* from. Empty
--                                          means any column. A card that
--                                          later moves elsewhere keeps its
--                                          link; this is the picker's filter,
--                                          not an invariant.
--   * board_fields.link_multiple         — one card or a list.
--   * board_fields.link_inverse_field_id — the field on the other board that
--                                          shows the same links from the far
--                                          end. Null for a one-way link.
--
-- The links themselves are stored once, in board_card_links, never in
-- board_cards.properties. A row is kept under the field it was made from,
-- from the card being edited to the card it names. A two-way pair
-- (Practitioner on events, Events on practitioners) reads its own rows front
-- to back and its partner's rows back to front (lib/boards/links.ts
-- linkSeenFrom), so a link made from either end shows on both, and neither
-- half is special. With one copy there is nothing to keep in step, the
-- reverse read is an index hit, and deleting either card takes its links
-- with it.

begin;

alter table public.board_fields
  drop constraint board_fields_kind_check;
alter table public.board_fields
  add constraint board_fields_kind_check
  check (kind in (
    'text', 'long_text', 'email', 'phone', 'number', 'yes_no',
    'choice', 'multi_choice', 'date', 'time', 'time_range', 'files',
    'card_link'
  ));

alter table public.board_fields
  -- Set null rather than cascade: deleting a board must not quietly delete
  -- another board's field. The field stays, says its board is gone, and
  -- can be archived by whoever runs that board.
  add column link_board_id uuid references public.boards (id) on delete set null,
  -- Column keys, which are permanent per board (board_columns.key), so a
  -- renamed column keeps its place in the filter.
  add column link_columns text[] not null default '{}',
  add column link_multiple boolean not null default false,
  -- Set null: deleting one half of a pair (only ever by deleting its board;
  -- fields are archived, not deleted) leaves the other a one-way link. An
  -- archived half keeps its pointer, so the links it made still show.
  add column link_inverse_field_id uuid references public.board_fields (id) on delete set null,
  add constraint board_fields_link_inverse_not_self
    check (link_inverse_field_id is null or link_inverse_field_id <> id);

comment on column public.board_fields.link_board_id is
  'Only meaningful for kind = card_link: the board whose cards answer this field. Null once that board is deleted.';
comment on column public.board_fields.link_columns is
  'Only meaningful for kind = card_link: board_columns.key values on link_board_id a card may be picked from. Empty means any column.';
comment on column public.board_fields.link_multiple is
  'Only meaningful for kind = card_link: whether more than one card may be linked.';
comment on column public.board_fields.link_inverse_field_id is
  'Only meaningful for kind = card_link: the card_link field on link_board_id that shows the same links from the other end. Null for a one-way link.';

create table public.board_card_links (
  id uuid primary key default gen_random_uuid(),
  -- The field the link was made from; its inverse reads the row reversed.
  field_id uuid not null references public.board_fields (id) on delete cascade,
  -- A card on field_id's board.
  from_card_id uuid not null references public.board_cards (id) on delete cascade,
  -- A card on field_id's link_board_id.
  to_card_id uuid not null references public.board_cards (id) on delete cascade,
  -- Session email of whoever made the link.
  created_by text not null check (char_length(created_by) between 3 and 320),
  created_at timestamptz not null default now(),
  unique (field_id, from_card_id, to_card_id),
  constraint board_card_links_not_self check (from_card_id <> to_card_id)
);

-- A card's own links: the drawer and the board read. The unique index above
-- leads with field_id, which serves "every link on this field".
create index board_card_links_from_idx on public.board_card_links (from_card_id);
-- The far end: every event a practitioner was linked from.
create index board_card_links_to_idx on public.board_card_links (to_card_id, field_id);

alter table public.board_card_links enable row level security;

-- App access is service-role (bypasses RLS) and gated in-route; these are
-- the convention the other board tables follow.
create policy "admins can select board card links"
  on public.board_card_links for select using (public.is_admin());
create policy "admins can insert board card links"
  on public.board_card_links for insert with check (public.is_admin());
create policy "admins can update board card links"
  on public.board_card_links for update using (public.is_admin()) with check (public.is_admin());
create policy "admins can delete board card links"
  on public.board_card_links for delete using (public.is_admin());

comment on table public.board_card_links is
  'Answers to card_link board fields, one row per link, stored under the field it was made from. That field''s inverse (board_fields.link_inverse_field_id) reads the same row with from/to swapped.';

-- The trail records a link made or undone on both cards, so the practitioner
-- card says "linked to Sauna Social" even though nobody opened it.
alter table public.board_events
  drop constraint board_events_action_check;
alter table public.board_events
  add constraint board_events_action_check
  check (action in (
    'created', 'updated', 'status_changed', 'assigned', 'due_changed',
    'moved', 'kpi_updated', 'completed', 'comment', 'linked', 'unlinked'
  ));

commit;
