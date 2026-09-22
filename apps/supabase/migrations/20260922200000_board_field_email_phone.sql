-- Two more shapes a board field can take: an email address and a phone
-- number.
--
-- Both are a line of text with a rule about it. A form that asks a stranger
-- how to reach them can now be sure it got something reachable, rather than
-- taking whatever was typed and finding out later — the check is in the app
-- (lib/boards/validate.ts normalizeAnswer), which is where every other
-- answer is shaped, and what is stored is canonical: an address lowercased,
-- a number as +<country><digits> with nothing else in it. What a card shows
-- is formatted from that.
--
-- A field's kind is no longer permanent either (the route converts the
-- answers already on the cards when it changes), so this is also the point
-- at which a text field somebody has been using for phone numbers can
-- simply become one.

begin;

alter table public.board_fields
  drop constraint board_fields_kind_check;
alter table public.board_fields
  add constraint board_fields_kind_check
  check (kind in (
    'text', 'email', 'phone', 'number', 'yes_no',
    'choice', 'multi_choice', 'date', 'time', 'time_range', 'files'
  ));

commit;
