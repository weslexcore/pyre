-- New inventory items, suggested from shift notes.
--
-- 1. inventory.create. A shift note that mentions a supply the inventory
--    does not track yet ("we've started keeping a box of earplugs at the
--    desk, 40 left") becomes a suggestion to add it: its name, and whatever
--    the note gives — category, where it is kept, how many are on hand.
--    Like every suggestion nothing changes until an admin approves it (and
--    edits it first if they like). The item is created by the approving
--    admin; its first count, when it has one, is credited to the note's
--    author at the time of the note, the same way an approved
--    inventory.count is (20261108200305_inventory_suggestions.sql).
--
--    Pyre Agent (/admin/ask) files the same kinds — inventory.count and
--    inventory.create — from the shift notes it reads in a conversation,
--    as one batch an admin can approve together. The kind and source
--    checks below already allow that source (20261116150551).
--
-- 2. Which suggestion made an item. Stamped on the item it created, unique,
--    so a retried approval finds the item the first attempt made instead of
--    adding it twice (and never trips the unique name index on itself).
--    The new item's history row carries the same suggestion through
--    inventory_history.suggestion_id, so its change log links the note.

-- ---------------------------------------------------------------------------
-- 1. The suggestion kind
-- ---------------------------------------------------------------------------

alter table public.agent_suggestions
  drop constraint agent_suggestions_kind_check;
alter table public.agent_suggestions
  add constraint agent_suggestions_kind_check
  check (kind in (
    'board_card.create',
    'board_card.comment',
    'sop.edit',
    'shift_assignment.update',
    'inventory.count',
    'inventory.create',
    'message.create',
    'message.edit'
  ));

-- ---------------------------------------------------------------------------
-- 2. Which suggestion made an item
-- ---------------------------------------------------------------------------

alter table public.inventory
  add column created_suggestion_id uuid
    references public.agent_suggestions (id) on delete set null;

create unique index inventory_created_suggestion_idx
  on public.inventory (created_suggestion_id)
  where created_suggestion_id is not null;

comment on column public.inventory.created_suggestion_id is
  'The approved agent suggestion (inventory.create) that added this item, when one did; its source is the shift note or Pyre Agent chat it was read from. Null for an item added by hand.';
