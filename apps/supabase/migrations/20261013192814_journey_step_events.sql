-- What happened at each step of each journey run.
--
-- journey_enrollments only says where someone is now, and email_sends only
-- records emails that went out. Neither says why a step didn't send — skipped
-- by a condition, too late, missing a merge field — or why someone left. This
-- log fills that gap so /admin/journeys can show a per-person timeline, and so
-- an admin walking a test address through a journey ("run next step now")
-- sees the outcome of every step.
--
--   * kind   — enrolled, sent, skipped, deferred, exited, completed, moved
--              (an admin put them on another step), restarted.
--   * detail — the engine's reason code (e.g. skip:not-attended-trigger-session,
--              missing-merge-field:creditsExpireOn, removed-by:<email>); the app
--              turns it into words.
--
-- Append-only and best-effort: the engine never fails a step because this
-- write failed.

create table public.journey_step_events (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.journey_enrollments (id) on delete cascade,
  journey_id text not null,
  member_id bigint not null,
  step_key text,
  kind text not null check (
    kind in ('enrolled', 'sent', 'skipped', 'deferred', 'exited', 'completed', 'moved', 'restarted')
  ),
  detail text check (detail is null or char_length(detail) <= 500),
  created_at timestamptz not null default now()
);

create index journey_step_events_enrollment_idx
  on public.journey_step_events (enrollment_id, created_at);

alter table public.journey_step_events enable row level security;

create policy "admins can select journey step events"
  on public.journey_step_events for select
  to authenticated
  using (public.is_admin());

grant all on table public.journey_step_events to service_role;
