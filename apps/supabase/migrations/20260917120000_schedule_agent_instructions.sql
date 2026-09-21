-- Standing instructions for the staff-scheduling agent: one admin-authored
-- block of higher-level requirements that holds for every AI schedule draft,
-- rather than the week-to-week steer the draft composer already sends as an
-- <admin-note> ("give Sarah a shift to lead").
--
-- The agents app reads this row when a scheduler session starts and folds it
-- into the drafter's system prompt, so it applies to manual drafts from the
-- board, refinement turns, and the Monday cron draft alike. The integrations
-- app owns the writes (/api/admin/schedule-instructions, admin-only).
--
-- One row, forever: `id` is a boolean pinned to true, so the primary key
-- admits exactly one value and an upsert can target it without the app
-- carrying an id around.

create table public.schedule_agent_instructions (
  id boolean primary key default true check (id),
  -- the admin's standing instructions; '' when cleared
  content text not null default '',
  -- dashboard email of the admin who last saved them
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.schedule_agent_instructions is
  'Singleton: the admin''s standing instructions for the AI schedule drafter, included in every draft run.';

-- Seed the row empty so a fresh database reads as "no standing instructions"
-- rather than as a missing row the reader has to special-case.
insert into public.schedule_agent_instructions (id, content) values (true, '');

create trigger schedule_agent_instructions_set_updated_at
  before update on public.schedule_agent_instructions
  for each row execute function public.set_updated_at();

-- The change log gains an 'agent_instructions' entity (action 'update'), so
-- edits to the standing prompt show up on /admin/schedule/changes next to
-- the drafts they shaped.
alter table public.schedule_changes
  drop constraint schedule_changes_entity_type_check;
alter table public.schedule_changes
  add constraint schedule_changes_entity_type_check
    check (
      entity_type in (
        'shift', 'assignment', 'time_off', 'proposal', 'sync', 'request',
        'sub_request', 'agent_instructions'
      )
    );

-- App access is service-role (bypasses RLS); enabling RLS with an
-- admin-select policy is forward-looking convention, same as the other
-- scheduling tables. Writes stay on the admin route, so select is the only
-- policy.
alter table public.schedule_agent_instructions enable row level security;

create policy "admins can select schedule agent instructions"
  on public.schedule_agent_instructions for select to authenticated using (public.is_admin());
