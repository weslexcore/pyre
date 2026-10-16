-- The scheduler agent drafts off-shift duties too.
--
-- When it drafts a week it now also proposes who fills the carboys on Monday,
-- weighs the propane on Sunday, and so on — but only for days nobody has
-- yet. Those land as draft duty_assignments rows on the week's proposal, the
-- same way its shift assignments do: shown dashed on the board for review,
-- live on approve (or on the row's ✓), deleted on discard / ✗ / supersede,
-- and never in the weekly email or a calendar feed while still a draft.
--
-- The one-person-per-duty-per-day constraint still holds across drafts and
-- live rows. A manager assigning that day by hand replaces the draft and
-- takes it live; the agent never drafts over a day that's already assigned.

alter table public.duty_assignments
  add column proposal_id uuid references public.schedule_proposals (id) on delete cascade,
  add column is_draft boolean not null default false;

comment on column public.duty_assignments.is_draft is
  'Proposed by the scheduler agent and awaiting review (see proposal_id); only the review UI shows it.';

create index duty_assignments_proposal_idx
  on public.duty_assignments (proposal_id)
  where proposal_id is not null;
