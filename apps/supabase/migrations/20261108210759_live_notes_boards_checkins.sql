-- Live updates for three more dashboard surfaces (apps/integrations), on the
-- pattern the bell and the SOP checklists set: AFTER triggers broadcast a
-- small {kind, op, ids} payload with realtime.send(), the island refetches
-- through its API (which keeps the access rules in one place), and a
-- realtime.messages policy per topic says who may listen. realtime.send()
-- swallows its own errors, so a Realtime outage never fails a write.
--
--   shift-notes                 shared notes (admin_only = false), their
--                               replies and attachments — the page's holders
--   shift-notes:admin           admin-only notes, and private replies — admins
--   shift-notes:author:<email>  admin-only notes — their author
--   board:<slug>                a board's cards and card activity — whoever
--                               may view that board
--   boards:all                  every card change plus board changes — the
--                               all-tasks and calendar pages (board managers)
--   goals                       goals, KPIs and goal activity — board managers
--   floor:checkins              the floor's check-ins — the Guests page
--
-- Two helpers mirror the app's page checks exactly. has_page() lets admins
-- through regardless; the app's canViewPage does not (an admin opens only
-- the pages they hold, like everyone else), so these policies use
-- holds_grant(), which reads staff.pages alone. Board visibility follows
-- lib/boards/access canViewBoard: every board (the Boards or legacy Goals
-- page) or the one board's own grant key.

create or replace function public.holds_grant(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p_key = any (s.pages) from public.staff s where s.id = public.current_staff_id()),
    false
  );
$$;

comment on function public.holds_grant(text) is
  'True when the signed-in caller''s staff row holds `p_key` in pages (a page href, capability or board grant). No admin shortcut — mirrors adminTools canViewPage.';

create or replace function public.can_manage_boards()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.holds_grant('/admin/boards') or public.holds_grant('/admin/goals');
$$;

create or replace function public.can_view_board(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_slug is not null
    and (public.can_manage_boards() or public.holds_grant('board:' || p_slug));
$$;

comment on function public.can_view_board(text) is
  'True when the signed-in caller may view the board with this slug: every board (Boards/Goals page) or its own board:<slug> grant. Mirrors lib/boards/access canViewBoard.';

-- ---------------------------------------------------------------------------
-- Shift notes
-- ---------------------------------------------------------------------------

-- Where a note's changes go: shared notes to the page's channel; admin-only
-- notes to the admins' channel and the author's own; a private reply to the
-- admins' channel only, whatever note it sits on.
create or replace function public.shift_note_topics(
  p_admin_only boolean,
  p_author text,
  p_private boolean
)
returns text[]
language sql
immutable
as $$
  select case
    when p_private then array['shift-notes:admin']
    when p_admin_only then array['shift-notes:admin', 'shift-notes:author:' || lower(coalesce(p_author, ''))]
    else array['shift-notes']
  end;
$$;

create or replace function public.shift_notes_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record := coalesce(new, old);
  payload jsonb;
  t text;
begin
  payload := jsonb_build_object('kind', 'note', 'op', tg_op, 'note_id', r.id);
  foreach t in array public.shift_note_topics(r.admin_only, r.author_email, false) loop
    perform realtime.send(payload, 'changed', t, true);
  end loop;
  -- A note moved between shared and admin-only: the side that lost it has
  -- to hear too, so it drops off their screens.
  if tg_op = 'UPDATE' and new.admin_only is distinct from old.admin_only then
    foreach t in array public.shift_note_topics(old.admin_only, old.author_email, false) loop
      perform realtime.send(payload, 'changed', t, true);
    end loop;
  end if;
  return null;
end;
$$;

create trigger shift_notes_broadcast
  after insert or update or delete on public.shift_notes
  for each row execute function public.shift_notes_broadcast();

create or replace function public.shift_note_replies_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record := coalesce(new, old);
  n record;
  t text;
begin
  -- A reply cascading away with its note finds no note; the note's own
  -- DELETE broadcast covers it.
  select admin_only, author_email into n from public.shift_notes where id = r.note_id;
  if not found then
    return null;
  end if;
  foreach t in array public.shift_note_topics(n.admin_only, n.author_email, coalesce(r.is_private, false)) loop
    perform realtime.send(
      jsonb_build_object('kind', 'reply', 'op', tg_op, 'note_id', r.note_id, 'reply_id', r.id),
      'changed', t, true
    );
  end loop;
  return null;
end;
$$;

create trigger shift_note_replies_broadcast
  after insert or update or delete on public.shift_note_replies
  for each row execute function public.shift_note_replies_broadcast();

create or replace function public.shift_note_attachments_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record := coalesce(new, old);
  n record;
  t text;
begin
  -- Staged uploads (no note yet) are nobody's business until the note lands.
  if r.note_id is null then
    return null;
  end if;
  select admin_only, author_email into n from public.shift_notes where id = r.note_id;
  if not found then
    return null;
  end if;
  foreach t in array public.shift_note_topics(n.admin_only, n.author_email, false) loop
    perform realtime.send(
      jsonb_build_object('kind', 'attachment', 'op', tg_op, 'note_id', r.note_id),
      'changed', t, true
    );
  end loop;
  return null;
end;
$$;

create trigger shift_note_attachments_broadcast
  after insert or update or delete on public.shift_note_attachments
  for each row execute function public.shift_note_attachments_broadcast();

create policy "shift notes holders receive shared note broadcasts"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'shift-notes'
    and public.holds_grant('/admin/shift-notes')
  );

create policy "admins receive admin-only note broadcasts"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'shift-notes:admin'
    and public.is_admin()
    and public.holds_grant('/admin/shift-notes')
  );

create policy "authors receive their admin-only note broadcasts"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'shift-notes:author:' || public.current_staff_email()
    and public.holds_grant('/admin/shift-notes')
  );

-- ---------------------------------------------------------------------------
-- Boards and goals
-- ---------------------------------------------------------------------------

create or replace function public.board_cards_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record := coalesce(new, old);
  v_slug text;
  v_old_slug text;
  payload jsonb;
begin
  -- Cards cascading away with their board find no board; the board's own
  -- DELETE broadcast (below) covers it.
  select slug into v_slug from public.boards where id = r.board_id;
  if v_slug is null then
    return null;
  end if;
  payload := jsonb_build_object('kind', 'card', 'op', tg_op, 'card_id', r.id, 'board', v_slug);
  perform realtime.send(payload, 'changed', 'board:' || v_slug, true);
  perform realtime.send(payload, 'changed', 'boards:all', true);
  -- A card moved to another board leaves the old one's screens too.
  if tg_op = 'UPDATE' and new.board_id is distinct from old.board_id then
    select slug into v_old_slug from public.boards where id = old.board_id;
    if v_old_slug is not null then
      perform realtime.send(payload, 'changed', 'board:' || v_old_slug, true);
    end if;
  end if;
  return null;
end;
$$;

create trigger board_cards_broadcast
  after insert or update or delete on public.board_cards
  for each row execute function public.board_cards_broadcast();

-- Activity (comments included) is insert-only: a card event goes to its
-- board, a goal event to the goals channel.
create or replace function public.board_events_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
  payload jsonb;
begin
  if new.card_id is not null then
    select b.slug into v_slug
    from public.board_cards c
    join public.boards b on b.id = c.board_id
    where c.id = new.card_id;
    if v_slug is null then
      return null;
    end if;
    payload := jsonb_build_object(
      'kind', 'event', 'op', tg_op, 'event_id', new.id, 'card_id', new.card_id, 'board', v_slug
    );
    perform realtime.send(payload, 'changed', 'board:' || v_slug, true);
    perform realtime.send(payload, 'changed', 'boards:all', true);
  elsif new.goal_id is not null then
    perform realtime.send(
      jsonb_build_object('kind', 'event', 'op', tg_op, 'event_id', new.id, 'goal_id', new.goal_id),
      'changed', 'goals', true
    );
  end if;
  return null;
end;
$$;

create trigger board_events_broadcast
  after insert on public.board_events
  for each row execute function public.board_events_broadcast();

-- Boards themselves (created, renamed, archived, deleted): the library of
-- boards and the all-boards pages.
create or replace function public.boards_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record := coalesce(new, old);
begin
  perform realtime.send(
    jsonb_build_object('kind', 'board', 'op', tg_op, 'board_id', r.id, 'board', r.slug),
    'changed', 'boards:all', true
  );
  return null;
end;
$$;

create trigger boards_broadcast
  after insert or update or delete on public.boards
  for each row execute function public.boards_broadcast();

create or replace function public.goals_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record := coalesce(new, old);
begin
  perform realtime.send(
    jsonb_build_object(
      'kind', tg_table_name,
      'op', tg_op,
      'goal_id', case when tg_table_name = 'goals' then r.id else r.goal_id end
    ),
    'changed', 'goals', true
  );
  return null;
end;
$$;

create trigger goals_broadcast
  after insert or update or delete on public.goals
  for each row execute function public.goals_broadcast();

create trigger goal_kpis_broadcast
  after insert or update or delete on public.goal_kpis
  for each row execute function public.goals_broadcast();

create policy "board viewers receive board broadcasts"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'board:%'
    and public.can_view_board(substring(realtime.topic() from 7))
  );

create policy "board managers receive all-boards and goals broadcasts"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() in ('boards:all', 'goals')
    and public.can_manage_boards()
  );

-- ---------------------------------------------------------------------------
-- Guest floor check-ins
-- ---------------------------------------------------------------------------

create or replace function public.guest_floor_checkins_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record := coalesce(new, old);
begin
  perform realtime.send(
    jsonb_build_object('kind', 'checkin', 'op', tg_op, 'booking_id', r.booking_id),
    'changed', 'floor:checkins', true
  );
  return null;
end;
$$;

create trigger guest_floor_checkins_broadcast
  after insert or update or delete on public.guest_floor_checkins
  for each row execute function public.guest_floor_checkins_broadcast();

create policy "guests page holders receive floor broadcasts"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'floor:checkins'
    and (public.holds_grant('/admin/guests') or public.holds_grant('guests:manage'))
  );
