-- Assignees on a column, so a card moving into it lands on whoever owns
-- that stage.
--
-- boards.default_assignee_emails says who a new card on the board starts
-- with. A pipeline is usually a hand-off, though: a rental enquiry is the
-- community manager's until it is quoted, then the founder's to sign, then
-- the site lead's once it is booked. Re-assigning by hand at each move was
-- the step that got forgotten, the same way assigning each new card was.
--
-- So:
--
--   * board_columns.assignee_emails — who a card is put on when it moves
--                                     into this column. Empty leaves the
--                                     card's assignees alone. The move is
--                                     applied by the card route (lib/boards
--                                     /cards columnPatch), not here, so the
--                                     bell tells the new assignees and the
--                                     trail records the hand-off; a move
--                                     that names its own assignees keeps
--                                     them.
--   * board_cards_sync_assignees    — a new card nobody was named on takes
--                                     its column's assignees, then the
--                                     board's defaults.

begin;

alter table public.board_columns
  add column assignee_emails text[] not null default '{}'
    check (cardinality(assignee_emails) <= 20);

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
      select c.assignee_emails into new.assignee_emails
      from public.board_columns c
      where c.id = new.column_id;
      new.assignee_emails := coalesce(new.assignee_emails, '{}');
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

comment on column public.board_columns.assignee_emails is
  'Who a card is assigned to when it moves into this column, replacing its assignees; also a new card''s assignees here ahead of the board''s defaults. Empty leaves the card alone.';
comment on column public.boards.default_assignee_emails is
  'Who a new card on this board is assigned to when whoever made it named nobody and its column names nobody. Applied by board_cards_sync_assignees.';

commit;
