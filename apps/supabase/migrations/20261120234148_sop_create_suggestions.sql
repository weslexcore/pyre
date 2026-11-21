-- New SOPs, suggested from shift notes and Pyre Agent chats.
--
-- 1. sop.create. Until now the agents could only suggest an edit to an SOP
--    that already exists (sop.edit — which can also add a whole new section
--    to one). Knowledge that belongs in no existing document — a procedure
--    a shift lead explained in a note, a policy settled in a chat — had
--    nowhere to go. sop.create carries a whole new document: its title,
--    slug, section of the library (category), markdown, and who may read and
--    edit it. Like every suggestion nothing changes until it is approved
--    (and edited first if the reviewer likes); creating documents is
--    admin-only, so only an admin can approve one. Once approved it is an
--    ordinary SOP, and the knowledge agent finds it like any other.
--
-- 2. Where an approved sop.create lives: result_type 'sop', the document it
--    made. Its first version (v1) carries the suggestion through
--    sop_versions.suggestion_id (unique, 20260926120000), so a retried
--    approval finds the document the first attempt made instead of
--    creating it twice, and the History panel links back to the source.

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
    'sop.create',
    'shift_assignment.update',
    'inventory.count',
    'inventory.create',
    'message.create',
    'message.edit'
  ));

-- ---------------------------------------------------------------------------
-- 2. The document an approved sop.create made
-- ---------------------------------------------------------------------------

alter table public.agent_suggestions
  drop constraint agent_suggestions_result_type_check;
alter table public.agent_suggestions
  add constraint agent_suggestions_result_type_check
  check (result_type in (
    'board_card',
    'board_event',
    'sop',
    'sop_version',
    'shift_assignment',
    'inventory_item',
    'admin_message'
  ));
