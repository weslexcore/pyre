-- One more shape a board field can take: long text.
--
-- The short text field is a line — a name, a reference, a room. Some
-- answers are a paragraph or several: what happened, what they asked for,
-- what to know before the session. Those were being typed into a line that
-- scrolled sideways, or into the card's notes where they stopped being an
-- answer to anything in particular.
--
-- A long text is stored the same way every other typed answer is, a string
-- in board_cards.properties, keeping its line breaks; what differs is the
-- control (the card's own notes box, wrapping, draggable taller) and the
-- length allowed (lib/boards/types.ts answerLimit). A card row shows the
-- same words with the breaks closed up, since a row is one line.

begin;

alter table public.board_fields
  drop constraint board_fields_kind_check;
alter table public.board_fields
  add constraint board_fields_kind_check
  check (kind in (
    'text', 'long_text', 'email', 'phone', 'number', 'yes_no',
    'choice', 'multi_choice', 'date', 'time', 'time_range', 'files'
  ));

commit;
