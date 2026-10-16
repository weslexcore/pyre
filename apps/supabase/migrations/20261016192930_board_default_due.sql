-- A board that dates its own new cards.
--
-- Some boards always want an answer by a certain time: a rental enquiry
-- should be followed up within two hours, a wholesale lead within two days,
-- a task within a week. Dating each new card by hand was the step that got
-- forgotten, the same way assigning it was before default_assignee_emails.
--
-- So:
--
--   * boards.default_due_every /
--     boards.default_due_unit   — "2 hours", "1 week": how long after it is
--                                 made a new card on this board is due. Both
--                                 or neither; neither leaves new cards
--                                 undated, as before.
--   * board_cards_default_due   — the insert trigger that applies it, so the
--                                 intake endpoint, the public forms, approved
--                                 suggestions, Pyre Agent and the board
--                                 itself all honour it. A card made with a
--                                 due date of its own keeps it, and one filed
--                                 straight into a finished column (already
--                                 done) is left undated.
--
-- A card's due date is a day, not a moment, so the rule resolves to the day
-- the deadline lands on in the bathhouse's time zone (America/New_York):
-- "2 hours" from 11pm is due tomorrow, from 3pm today. Days, weeks and
-- months count from today's date there. lib/boards/default-due.ts does the
-- same arithmetic for the settings preview.

begin;

alter table public.boards
  add column default_due_every smallint
    check (default_due_every between 1 and 365),
  add column default_due_unit text
    check (default_due_unit in ('hour', 'day', 'week', 'month')),
  -- A rule is both halves or neither.
  add constraint boards_default_due_whole
    check ((default_due_every is null) = (default_due_unit is null));

-- Dates a new card the board's rule, unless whoever made it gave a date or
-- it arrives already finished.
create or replace function public.board_cards_default_due()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  rule_every smallint;
  rule_unit text;
  today date;
begin
  if new.due_date is not null or new.completed_at is not null then
    return new;
  end if;

  select b.default_due_every, b.default_due_unit
  into rule_every, rule_unit
  from public.boards b
  where b.id = new.board_id;

  if rule_every is null or rule_unit is null then
    return new;
  end if;

  if rule_unit = 'hour' then
    new.due_date := ((now() + make_interval(hours => rule_every)) at time zone 'America/New_York')::date;
    return new;
  end if;

  today := (now() at time zone 'America/New_York')::date;
  new.due_date := case rule_unit
    when 'day' then today + rule_every
    when 'week' then today + rule_every * 7
    -- date + interval clamps to the month's length: Jan 31 + 1 month is Feb 28.
    else (today + make_interval(months => rule_every))::date
  end;
  return new;
end;
$$;

create trigger board_cards_default_due
  before insert on public.board_cards
  for each row execute function public.board_cards_default_due();

comment on column public.boards.default_due_every is
  'With default_due_unit, how long after it is made a new card on this board is due. Null (with the unit) leaves new cards undated. Applied by board_cards_default_due.';
comment on column public.boards.default_due_unit is
  'hour, day, week, or month. Hours resolve to the America/New_York day the deadline lands on, since a due date is a day.';

commit;
