-- Special-event conflict reviews.
--
-- Pyre's schedule lives in Momence, and it is built by hand: hourly Open Hours
-- slots and Friday Social evenings are created weeks out as a stack of
-- overlapping sessions (1h entry slots plus the 2/3/4h partners that share a
-- start). When a one-off special event (Momence tag "Special Event" — a
-- Thursday workshop, a Friday DJ night) is added on top, the regular sessions
-- in that window have to be cancelled by hand, and nobody was reminding anyone
-- to do it. Guests could book an Open Hours slot straight into a private event.
--
-- A Monday cron job (session-conflicts) reads the Momence events feed, finds
-- every regular session overlapping a special event in the next four weeks,
-- writes what it found here, and emails the admins. An admin then reviews the
-- list on /admin/session-conflicts and cancels the sessions in Momence from
-- there. This table is the paper trail of that decision.
--
-- Momence stays the source of truth. Nothing in here is a schedule: `conflicts`
-- is a snapshot of what the detector saw, `resolution` is what the admin did
-- about each session. Re-running the check merges into the open review rather
-- than replacing it, so what an admin already saw does not silently vanish.

create table public.session_conflict_reviews (
  id uuid primary key default gen_random_uuid(),

  -- ISO Monday (America/New_York) of the run that created the row. The
  -- weekly cron's idempotency key: one cron review per week, see the index.
  week_start date not null,
  -- The ET calendar window the detector scanned (today .. today + 28 days).
  horizon_start date not null,
  horizon_end date not null,

  -- pending    — conflicts found, nobody has acted on all of them yet
  -- resolved   — every session has an outcome (cancelled / skipped / cleared)
  -- clear      — the run found nothing overlapping a special event
  -- superseded — an open review replaced by a fresh Monday run
  status text not null default 'pending'
    check (status in ('pending', 'resolved', 'clear', 'superseded')),
  -- cron = the Monday job; manual = "Check now" on the admin page
  source text not null default 'cron' check (source in ('cron', 'manual')),

  -- Detector snapshot, one group per special event:
  --   [{ specialEvent: { id, title, startsAt, endsAt, location, link },
  --      sessions: [{ id, title, tag, type, startsAt, endsAt, location,
  --                   bookingCount, capacity, link, preselected }] }]
  conflicts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(conflicts) = 'array'),
  -- Distinct sessions across all groups (a slot under two events counts once).
  session_count integer not null default 0,
  -- Momence session id -> { outcome, message?, via?, at, by }
  --   cancelled   — cancelled in Momence through the API
  --   failed      — Momence rejected the cancel; retryable
  --   unsupported — this Momence account exposes no cancel endpoint
  --   skipped     — left in place on purpose (review-only, or "handled manually")
  --   cleared     — no longer overlapping / already off the schedule
  resolution jsonb not null default '{}'::jsonb
    check (jsonb_typeof(resolution) = 'object'),

  -- When the admins were emailed about this review, and how many of them.
  notified_at timestamptz,
  notified_count integer not null default 0,

  -- Dashboard email of whoever closed the review; null while pending.
  resolved_at timestamptz,
  resolved_by text,

  -- When the detector last looked at Momence for this review ("Check now"
  -- bumps it; the cron sets it at creation).
  checked_at timestamptz not null default now(),
  -- 'cron', or the dashboard email of the admin who pressed "Check now".
  created_by text not null default 'cron',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One cron review per week, enforced in the database so two hourly ticks
-- racing on a Monday morning cannot both insert one.
create unique index session_conflict_reviews_cron_week_idx
  on public.session_conflict_reviews (week_start)
  where source = 'cron';

-- At most one open review at a time: the page shows "the" pending review,
-- and a fresh run merges into it or supersedes it, never sits beside it.
create unique index session_conflict_reviews_pending_idx
  on public.session_conflict_reviews (status)
  where status = 'pending';

-- The history list's ordering.
create index session_conflict_reviews_created_idx
  on public.session_conflict_reviews (created_at desc);

-- App access is service-role (bypasses RLS); enabling RLS with an
-- admin-select policy is forward-looking convention, same as the other
-- admin-tool tables.
alter table public.session_conflict_reviews enable row level security;

create policy "admins can select session conflict reviews"
  on public.session_conflict_reviews for select to authenticated
  using (public.is_admin());

create trigger session_conflict_reviews_set_updated_at
  before update on public.session_conflict_reviews
  for each row execute function public.set_updated_at();
