-- Pyre Agent routine runs outlive their routine. A conversation a routine
-- opened is marked as one on the Pyre Agent page (the sidebar and the
-- conversation say which routine ran it), and that should stay true after
-- the routine is deleted — its answers stay in the owner's history. So a run
-- now keeps its routine's name and owner, and deleting the routine leaves
-- the run with routine_id null instead of deleting it.

alter table public.pyre_agent_routine_runs
  add column routine_title text check (routine_title is null or char_length(routine_title) <= 100),
  add column owner_email text check (owner_email is null or char_length(owner_email) between 3 and 320);

-- Existing runs take their routine's name and owner.
update public.pyre_agent_routine_runs as run
set routine_title = routine.title,
    owner_email = routine.owner_email
from public.pyre_agent_routines as routine
where routine.id = run.routine_id;

alter table public.pyre_agent_routine_runs
  alter column routine_title set not null,
  alter column owner_email set not null,
  alter column routine_id drop not null,
  drop constraint pyre_agent_routine_runs_routine_id_fkey,
  add constraint pyre_agent_routine_runs_routine_id_fkey
    foreign key (routine_id) references public.pyre_agent_routines (id) on delete set null;

comment on column public.pyre_agent_routine_runs.routine_title is
  'The routine''s name when it ran, kept after the routine is deleted so its conversation still says which routine opened it.';
comment on column public.pyre_agent_routine_runs.owner_email is
  'Whose routine it was (the person the run ran as); the owner check for reading a run once its routine is gone.';
