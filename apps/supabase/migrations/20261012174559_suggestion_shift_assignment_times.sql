-- Suggested schedule changes: a shift note that says someone worked other
-- hours than scheduled ("Sam and I stayed until 8:30") becomes a suggestion
-- to re-time that person's assignment on the shift, so the timesheet pays
-- what was actually worked. Like every suggestion, nothing changes until an
-- admin approves it.
--
-- The new kind acts on an existing assignment (target), and its result is
-- that same assignment, re-timed. The checks below are the ones
-- 20260926120000_agent_suggestions.sql declared inline, each widened by one
-- value.

alter table public.agent_suggestions
  drop constraint agent_suggestions_kind_check;
alter table public.agent_suggestions
  add constraint agent_suggestions_kind_check
  check (kind in ('board_card.create', 'board_card.comment', 'sop.edit', 'shift_assignment.update'));

alter table public.agent_suggestions
  drop constraint agent_suggestions_target_type_check;
alter table public.agent_suggestions
  add constraint agent_suggestions_target_type_check
  check (target_type in ('board_card', 'sop', 'shift_assignment'));

alter table public.agent_suggestions
  drop constraint agent_suggestions_result_type_check;
alter table public.agent_suggestions
  add constraint agent_suggestions_result_type_check
  check (result_type in ('board_card', 'board_event', 'sop_version', 'shift_assignment'));
