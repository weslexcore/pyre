-- One more shape a board field can take: a checklist.
--
-- Some cards are a procedure as much as a task: onboarding a practitioner
-- (contract signed, W-9 in, intro call booked), turning over an event
-- (towels counted, sauna logged, deposit returned). Those steps were being
-- typed into each card's notes by hand and ticked off by editing the text,
-- with nothing to say who did which, and nothing to notice when the last one
-- was done.
--
-- A checklist field carries a default list, written in the same markdown the
-- SOP library uses: `- [ ]` for an item, `- [!]` for one that must be checked
-- off and can never be skipped, prose and headings in between. Every card on
-- the board starts from that list; a card can edit its own copy without
-- touching the default. Items are completed or skipped the way an SOP run's
-- are, and each says who resolved it and when.
--
--   * board_fields.checklist_md          — the default list. Empty for every
--                                          other kind.
--   * board_fields.checklist_done_column — the key of a column on this board
--                                          the card moves to the moment its
--                                          checklist is finished: every item
--                                          resolved, every required one
--                                          completed. Null leaves the card
--                                          where it is. A key rather than an
--                                          id because column keys are
--                                          permanent per board
--                                          (board_columns.key), the way
--                                          link_columns names them.
--
-- A card's answer lives in board_cards.properties under the field's key,
-- like every typed answer: { md, checks: [{ i, t, s, by, at }] } — the
-- card's own copy of the list, and one entry per resolved item (index, the
-- item's text, skipped or not, who, when). Before anyone touches it there is
-- no answer, and the card shows the field's default. The shape is checked in
-- the app (lib/boards/checklist.ts), and `by`/`at` are stamped by the route
-- from the session, never taken from the request.

begin;

alter table public.board_fields
  drop constraint board_fields_kind_check;
alter table public.board_fields
  add constraint board_fields_kind_check
  check (kind in (
    'text', 'long_text', 'email', 'phone', 'number', 'yes_no',
    'choice', 'multi_choice', 'date', 'time', 'time_range', 'files',
    'card_link', 'checklist'
  ));

alter table public.board_fields
  add column checklist_md text not null default ''
    check (char_length(checklist_md) <= 10000),
  -- Same shape as board_columns.key. Not a foreign key: a column that is
  -- archived or removed later simply stops being a destination, and the
  -- card stays put (the route checks the column is live before moving).
  add column checklist_done_column text
    check (checklist_done_column is null or checklist_done_column ~ '^[a-z][a-z0-9_]{1,39}$');

comment on column public.board_fields.checklist_md is
  'Only meaningful for kind = checklist: the default list every card starts from, as markdown (- [ ] item, - [!] required item).';
comment on column public.board_fields.checklist_done_column is
  'Only meaningful for kind = checklist: board_columns.key of the column a card moves to once its checklist is finished. Null leaves it in place.';

commit;
