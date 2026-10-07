-- A column that unassigns a card moving into it.
--
-- board_columns.assignee_emails (20261006175933) gave a column two ways to
-- treat a card arriving: hand it to the people named, or, when the list is
-- empty, leave whoever had it. Some stages belong to nobody — a lead parked
-- in "On hold", a task dropped into "Someday" — and the card should come
-- off whoever was carrying it rather than sit on their list.
--
--   * board_columns.clears_assignees — a card moving into this column loses
--                                      all its assignees. Only with an
--                                      empty assignee_emails: a column
--                                      either hands off or clears, never
--                                      both. Applied by the card route
--                                      (lib/boards/cards columnPatch), like
--                                      the hand-off, so the trail records
--                                      it; a move that names its own
--                                      assignees keeps them.
--
-- A new card added straight into such a column is not affected:
-- board_cards_sync_assignees still falls through to the board's defaults.

begin;

alter table public.board_columns
  add column clears_assignees boolean not null default false,
  add constraint board_columns_clears_or_assigns
    check (not clears_assignees or cardinality(assignee_emails) = 0);

comment on column public.board_columns.clears_assignees is
  'A card moved into this column is unassigned from everyone. Only when assignee_emails is empty; false with an empty list leaves the card''s assignees alone.';

commit;
