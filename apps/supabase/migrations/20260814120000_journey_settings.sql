-- Runtime on/off switch for email journeys, managed from
-- /admin/email-templates (apps/integrations). Until now the only way to stop a
-- journey was editing the JOURNEYS array in
-- src/lib/email/journeys/registry.ts and redeploying — and gating the
-- journey's template was no substitute, because a gated step is suppressed
-- while advanceDueJourneys() still advances the enrollment, silently burning
-- the member's way through the journey.
--
-- Off means paused, not cancelled: the engine stops enrolling (both the event
-- and sweep paths) and stops advancing due rows, so members mid-journey hold
-- their place. Turning it back on bumps the held rows' next_at to now so a long
-- pause doesn't leave a backlog of long-overdue rows monopolizing the
-- next_at-ordered advance queue ahead of every other journey.

-- One row per journey an admin has explicitly switched; no row = enabled.
-- Journey ids are NOT foreign-keyed anywhere — the registry lives in code
-- (src/lib/email/journeys/registry.ts) and rows for removed journeys are
-- harmless, same as email_template_overrides.
create table public.journey_settings (
  -- Journey.id from the code registry, e.g. 'post-intro-offer'.
  journey_id text primary key
    check (journey_id = lower(journey_id) and btrim(journey_id) <> ''),
  enabled boolean not null,
  -- dashboard email of the admin who last flipped it
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- No secondary indexes and no seeded rows: the table holds a handful of rows,
-- is read through a 30s in-process cache (src/lib/email/journeys/settings.ts),
-- and a missing row already reads as enabled.

alter table public.journey_settings enable row level security;

-- App access is service-role (bypasses RLS); this policy is forward-looking
-- convention, same as the other tables.
create policy "admins can select journey_settings"
  on public.journey_settings for select
  to authenticated
  using (public.is_admin());

create trigger journey_settings_set_updated_at
  before update on public.journey_settings
  for each row execute function public.set_updated_at();
