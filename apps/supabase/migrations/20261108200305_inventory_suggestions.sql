-- Inventory meets the agents.
--
-- 1. Suggested inventory counts. A shift note that says how much of
--    something is left ("three rolls of trash bags left", "we're out of
--    eucalyptus") becomes an inventory.count suggestion: set that item's
--    stock to the number the note gives. Like every suggestion nothing
--    changes until an admin approves it; when they do, the count is recorded
--    as taken by the note's author at the time of the note, with a link back
--    to the note, not as a count by the approving admin.
--
--    The new kind acts on an existing item (target) and its result is that
--    same item, re-counted. The checks below are the ones
--    20260926120000_agent_suggestions.sql declared inline (and
--    20261012174559 widened once), each widened by one more value.
--
-- 2. Where a count came from. An approved suggestion stamps itself on the
--    item (last_count_suggestion_id) and on the history row it writes
--    (inventory_history.suggestion_id), so the list can say "counted by Maya,
--    from her shift note" and the item's change log can link the note. A
--    count made by hand clears the item's stamp. The history stamp is unique,
--    so a retried approval finds the row the first attempt wrote instead of
--    writing it twice (the same idempotency the cards and SOP versions use).
--
-- 3. Pyre Agent (/admin/ask) can propose inventory changes in a conversation,
--    applied only when the person presses Apply, through the inventory API
--    as them: a count or a field change on an item (inventory.update), or a
--    new item (inventory.create).

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
    'inventory.count'
  ));

alter table public.agent_suggestions
  drop constraint agent_suggestions_target_type_check;
alter table public.agent_suggestions
  add constraint agent_suggestions_target_type_check
  check (target_type in ('board_card', 'sop', 'shift_assignment', 'inventory_item'));

alter table public.agent_suggestions
  drop constraint agent_suggestions_result_type_check;
alter table public.agent_suggestions
  add constraint agent_suggestions_result_type_check
  check (result_type in (
    'board_card',
    'board_event',
    'sop_version',
    'shift_assignment',
    'inventory_item'
  ));

-- ---------------------------------------------------------------------------
-- 2. Where a count came from
-- ---------------------------------------------------------------------------

alter table public.inventory
  add column last_count_suggestion_id uuid
    references public.agent_suggestions (id) on delete set null;

comment on column public.inventory.last_count_suggestion_id is
  'The approved agent suggestion that set the current last count, when it came from one (its source is the shift note the count was read from); null for a count made by hand.';

alter table public.inventory_history
  add column suggestion_id uuid
    references public.agent_suggestions (id) on delete set null;

create unique index inventory_history_suggestion_idx
  on public.inventory_history (suggestion_id)
  where suggestion_id is not null;

comment on column public.inventory_history.suggestion_id is
  'The agent suggestion an admin approved to make this change, if any; through it, the shift note the count came from.';

-- ---------------------------------------------------------------------------
-- 3. Pyre Agent proposals about inventory
-- ---------------------------------------------------------------------------

alter table public.pyre_agent_actions
  drop constraint pyre_agent_actions_kind_check;
alter table public.pyre_agent_actions
  add constraint pyre_agent_actions_kind_check
  check (kind in (
    'board.create',
    'board_card.create',
    'board_card.update',
    'board_card.comment',
    'goal_kpi.measure',
    'inventory.update',
    'inventory.create'
  ));

comment on table public.pyre_agent_actions is
  'Changes Pyre Agent proposed in a conversation (/admin/ask) to the boards or the inventory, applied only when the asker presses Apply: the dashboard API request to replay, its status, and what it made.';
