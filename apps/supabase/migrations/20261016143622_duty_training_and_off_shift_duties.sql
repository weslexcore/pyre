-- Duties grow two things: training, and duties that aren't part of a shift.
--
-- Training. Some jobs need someone who has been shown how: plunge care, the
-- propane, the fire. A duty marked requires_training can only be given to the
-- people listed against it in staff_duty_training: the schedule board's
-- picker offers it to nobody else, the assignments API rejects it, and the
-- scheduler agent's drafts drop it. Every existing duty starts open to
-- everyone (requires_training = false), so turning this on is a per-duty
-- choice made after the trained list is filled in, and nobody's shift changes
-- on the day this ships. Duties already held when someone's training is
-- removed stay readable where they are, the way an archived duty does.
--
-- Off-shift duties. Some jobs happen on a weekday whether or not anyone works
-- a shift: fill the water carboys on Monday, weigh the propane on Sunday.
-- They live in the same list as the shift duties (phase 'off_shift'), so they
-- get the same SOP link, days of the week, archiving and training, edited at
-- /admin/schedule/duties. They are never held on a shift assignment; each
-- day the duty runs is an occurrence handed to one person in
-- duty_assignments, on the schedule board. A duty can't move between being a
-- shift duty and an off-shift one (the API refuses): the two are stored in
-- different places, so the move would strand whatever was assigned.

-- --- Off-shift phase ------------------------------------------------------

alter table public.shift_duties drop constraint shift_duties_phase_check;
alter table public.shift_duties
  add constraint shift_duties_phase_check
    check (phase in ('setup', 'session', 'breakdown', 'off_shift'));

comment on column public.shift_duties.phase is
  'Part of the shift the duty belongs to (setup, session, breakdown), or off_shift for a job done on its days apart from any shift (assigned per day in duty_assignments).';

-- --- Training -------------------------------------------------------------

alter table public.shift_duties
  add column requires_training boolean not null default false;

comment on column public.shift_duties.requires_training is
  'Only the people in staff_duty_training for this duty may be given it. False = anyone on the roster.';

create table public.staff_duty_training (
  staff_id uuid not null references public.staff (id) on delete cascade,
  -- A duty with trained people is never deleted (it's archived), but a
  -- never-used one can be; its training list goes with it.
  duty_key text not null references public.shift_duties (key) on delete cascade,
  -- Dashboard email of the manager who marked them trained.
  trained_by text,
  created_at timestamptz not null default now(),
  primary key (staff_id, duty_key)
);

comment on table public.staff_duty_training is
  'Who is trained on which duty (public.shift_duties). Gates duties marked requires_training. Edited at /admin/schedule/duties.';

create index staff_duty_training_duty_idx on public.staff_duty_training (duty_key);

alter table public.staff_duty_training enable row level security;

-- App access is service-role (bypasses RLS) and gated in-route; these follow
-- the shift_duties convention. Who is trained on what isn't sensitive: the
-- whole team sees who holds which duty on the board already.
create policy "authenticated users can select duty training"
  on public.staff_duty_training for select
  to authenticated
  using (true);

create policy "admins can insert duty training"
  on public.staff_duty_training for insert
  with check (public.is_admin());

create policy "admins can update duty training"
  on public.staff_duty_training for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins can delete duty training"
  on public.staff_duty_training for delete
  using (public.is_admin());

grant all on table public.staff_duty_training to service_role;
grant select on table public.staff_duty_training to authenticated;

-- --- Off-shift duty assignments --------------------------------------------

create table public.duty_assignments (
  id uuid primary key default gen_random_uuid(),
  -- Restrict, not cascade: a duty someone has been given is archived, never
  -- deleted (the API counts these alongside shift assignments).
  duty_key text not null references public.shift_duties (key) on delete restrict,
  duty_date date not null,
  staff_id uuid not null references public.staff (id) on delete cascade,
  notes text check (notes is null or length(notes) <= 500),
  -- Ticked off by the person (or a manager) once it's done; null until then.
  done_at timestamptz,
  done_by text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One person per duty per day: reassigning replaces them.
  constraint duty_assignments_one_per_day unique (duty_key, duty_date)
);

comment on table public.duty_assignments is
  'Who does an off-shift duty (shift_duties.phase = off_shift) on a given day. Assigned on the schedule board; the person ticks it done.';

create index duty_assignments_date_idx on public.duty_assignments (duty_date);
create index duty_assignments_staff_idx on public.duty_assignments (staff_id, duty_date);

alter table public.duty_assignments enable row level security;

create policy "authenticated users can select duty assignments"
  on public.duty_assignments for select
  to authenticated
  using (true);

create policy "admins can insert duty assignments"
  on public.duty_assignments for insert
  with check (public.is_admin());

create policy "admins can update duty assignments"
  on public.duty_assignments for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins can delete duty assignments"
  on public.duty_assignments for delete
  using (public.is_admin());

grant all on table public.duty_assignments to service_role;
grant select on table public.duty_assignments to authenticated;

-- --- Change log -------------------------------------------------------------

-- Off-shift assignments and training changes show on /admin/schedule/changes
-- beside the shift edits.
alter table public.schedule_changes
  drop constraint schedule_changes_entity_type_check;
alter table public.schedule_changes
  add constraint schedule_changes_entity_type_check
    check (
      entity_type in (
        'shift', 'assignment', 'time_off', 'proposal', 'sync', 'request',
        'sub_request', 'agent_instructions', 'staff_prefs',
        'duty_assignment', 'duty_training'
      )
    );
