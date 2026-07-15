-- Email marketing & journeys state for apps/integrations.
-- See plan: /Users/w/.claude/plans/review-our-integrations-project-starry-spark.md
--
-- Design: Momence stays the source of truth for customers/visits/credits; these
-- tables hold only durable engine state that must never be lost or double-fired:
--   journey_enrollments — where each member is in each journey (never why; the
--     engine re-checks live Momence data before every send)
--   email_sends         — append-only audit log of every email the integrations
--     app sends, doubling as the long-horizon dedupe guard via send_key
--   email_suppressions  — the single authoritative marketing suppression list
--     (compliance data; Resend and Mailchimp are downstream mirrors)
--
-- All access is server-side from apps/integrations via the service-role key,
-- which bypasses RLS. RLS is enabled with admin-only select policies so a future
-- admin dashboard can read (matching the instagram_automation migration pattern).

-- Journey state: one row per (journey, member), created on enrollment and kept
-- forever — the unique constraint is what makes once-per-lifetime journeys
-- structurally unable to re-enroll someone.
create table public.journey_enrollments (
  id uuid primary key default gen_random_uuid(),
  journey_id text not null,
  member_id bigint not null,
  email text not null check (email = lower(email)),
  -- index of the next step to send (0-based into the journey's steps array)
  step integer not null default 0,
  -- when the next step becomes due; null once completed/exited
  next_at timestamptz,
  status text not null default 'active' check (status in ('active', 'completed', 'exited')),
  -- why the member left the journey early (e.g. 'bought-membership'), null otherwise
  exit_reason text,
  enrolled_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (journey_id, member_id)
);

-- The scheduler query: everything active and due.
create index journey_enrollments_due_idx
  on public.journey_enrollments (next_at)
  where status = 'active';

create index journey_enrollments_email_idx
  on public.journey_enrollments (email);

alter table public.journey_enrollments enable row level security;

create policy "admins can select journey enrollments"
  on public.journey_enrollments for select
  to authenticated
  using (public.is_admin());

create trigger journey_enrollments_set_updated_at
  before update on public.journey_enrollments
  for each row execute function public.set_updated_at();

-- Append-only send log. send_key is the idempotency guard for anything that
-- must not repeat over long horizons (e.g. 'review-request:{memberId}',
-- 'credit-expiry:{boughtMembershipId}:14') — insert-before-send, unique index
-- rejects duplicates. Rows are never updated except to record the final status.
create table public.email_sends (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  member_id bigint,
  template text not null,
  kind text not null default 'transactional' check (kind in ('transactional', 'marketing')),
  journey_id text,
  step_id text,
  campaign text,
  -- long-horizon dedupe key; null for sends that dedupe elsewhere (webhook retries use redis)
  send_key text unique,
  -- resend message id, for joining against resend webhook events
  resend_id text,
  status text not null check (status in ('sent', 'skipped', 'suppressed', 'failed')),
  sent_at timestamptz not null default now()
);

-- "Every email we ever sent this person", newest first.
create index email_sends_email_idx
  on public.email_sends (email, sent_at desc);

create index email_sends_journey_idx
  on public.email_sends (journey_id, sent_at desc)
  where journey_id is not null;

alter table public.email_sends enable row level security;

create policy "admins can select email sends"
  on public.email_sends for select
  to authenticated
  using (public.is_admin());

-- The single source of truth for marketing suppression. Inbound writers: our
-- /api/unsubscribe route, the resend webhook (bounces/complaints/unsubscribes),
-- the mailchimp audience webhook, and imports of Momence marketing opt-outs.
-- sendTemplate() checks this table before every marketing send.
create table public.email_suppressions (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  reason text not null check (reason in ('unsubscribe', 'complaint', 'bounce', 'momence', 'manual')),
  -- which system reported it (e.g. 'resend-webhook', 'mailchimp-webhook', 'unsubscribe-link')
  source text,
  created_at timestamptz not null default now()
);

alter table public.email_suppressions enable row level security;

create policy "admins can select email suppressions"
  on public.email_suppressions for select
  to authenticated
  using (public.is_admin());
