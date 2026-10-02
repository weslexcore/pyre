-- Several people on one card, a board that assigns its own cards, and cards
-- that come back.
--
-- Three things the boards could not say:
--
--   * a card is often two people's job — the founders split a task, a lead is
--     worked by the community manager and whoever is on site — and a single
--     owner_email made one of them invisible on All Tasks and in the bell;
--   * some boards always land on the same people (every rental enquiry goes
--     to the community manager), and assigning each new card by hand was the
--     step that got forgotten;
--   * some work comes back on a schedule (deep-clean the stoves every month,
--     renew the insurance every year), and was being re-typed each time.
--
-- So:
--
--   * board_cards.assignee_emails     — everyone the card is on, lowercased by
--                                       the route, in the order they were
--                                       added. Replaces owner_email.
--   * boards.default_assignee_emails  — who a new card on this board is put
--                                       on when whoever made it named nobody.
--                                       Applied here, in the insert trigger,
--                                       so the intake endpoint, the public
--                                       forms, approved suggestions and the
--                                       board itself all honour it.
--   * board_cards.repeat_every /
--     board_cards.repeat_unit         — "every 2 weeks". When a repeating card
--                                       is finished, the app files the next
--                                       one in the board's first open column,
--                                       due on the next date, and hands the
--                                       rule to it (lib/boards/recurrence.ts).
--                                       The finished card keeps its history
--                                       and stops repeating, so pulling it
--                                       back out of Done and in again never
--                                       makes a second copy.
--
-- owner_email stays for now, kept equal to the first assignee by the trigger
-- below, so anything still reading it (and an older deploy still writing it
-- during the release) keeps working. A later migration drops it.

begin;

alter table public.board_cards
  add column assignee_emails text[] not null default '{}'
    check (cardinality(assignee_emails) <= 20),
  add column repeat_every smallint
    check (repeat_every between 1 and 365),
  add column repeat_unit text
    check (repeat_unit in ('day', 'week', 'month', 'year')),
  -- A rule is both halves or neither.
  add constraint board_cards_repeat_whole
    check ((repeat_every is null) = (repeat_unit is null));

alter table public.boards
  add column default_assignee_emails text[] not null default '{}'
    check (cardinality(default_assignee_emails) <= 20);

-- Every card that had an owner has that one assignee.
update public.board_cards
set assignee_emails = array[owner_email]
where owner_email is not null;

-- Keeps owner_email and assignee_emails saying the same thing, whichever one
-- a writer set, and gives a new card nobody was named on the board's
-- defaults.
create or replace function public.board_cards_sync_assignees()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if cardinality(new.assignee_emails) = 0 and new.owner_email is not null then
      new.assignee_emails := array[new.owner_email];
    end if;
    if cardinality(new.assignee_emails) = 0 then
      select b.default_assignee_emails into new.assignee_emails
      from public.boards b
      where b.id = new.board_id;
      new.assignee_emails := coalesce(new.assignee_emails, '{}');
    end if;
  elsif new.assignee_emails is distinct from old.assignee_emails then
    null; -- the list was written; owner_email follows it below
  elsif new.owner_email is distinct from old.owner_email then
    new.assignee_emails := case
      when new.owner_email is null then '{}'::text[]
      else array[new.owner_email]
    end;
  end if;
  new.owner_email := new.assignee_emails[1];
  return new;
end;
$$;

create trigger board_cards_sync_assignees
  before insert or update on public.board_cards
  for each row execute function public.board_cards_sync_assignees();

-- All Tasks: what each person still owes. Replaces the owner_email index.
drop index if exists public.board_cards_owner_open_idx;
create index board_cards_assignees_open_idx
  on public.board_cards using gin (assignee_emails) where completed_at is null;

comment on column public.board_cards.assignee_emails is
  'Everyone the card is on, lowercased, in the order they were added. Empty while unassigned.';
comment on column public.board_cards.owner_email is
  'Deprecated: the first of assignee_emails, kept in step by board_cards_sync_assignees. Read assignee_emails.';
comment on column public.board_cards.repeat_every is
  'With repeat_unit, how often the card comes back: finishing it files the next one, due that much later.';
comment on column public.board_cards.repeat_unit is
  'day, week, month, or year. Null (with repeat_every) for a card that does not repeat.';
comment on column public.boards.default_assignee_emails is
  'Who a new card on this board is assigned to when whoever made it named nobody. Applied by board_cards_sync_assignees.';

commit;
