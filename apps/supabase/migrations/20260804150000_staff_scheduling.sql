-- Staff scheduling: replaces the "Pyre Staffing Schedule" spreadsheet.
-- Managed from /admin/schedule in apps/integrations; employees get read access
-- and time-off self-service in a later phase. Scope + decisions live in
-- apps/integrations/docs/staff-scheduling-scope.md.
--
-- Dates and times are stored as local wall-clock values (America/New_York),
-- matching how shifts are planned and how the sheet recorded them. Momence
-- timestamps (UTC) are converted before they land here.

-- The roster (was the "Staff" sheet). momence_email is the join key against
-- the Momence OAuth login profile; it starts null and is filled in from the
-- roster admin page as people's accounts are confirmed.
create table public.schedule_staff (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  momence_email text unique,
  -- 'admin' mirrors ADMIN_EMAILS-level access within scheduling features;
  -- route-level auth stays on the env allowlists.
  role text not null default 'staff' check (role in ('admin', 'staff')),
  -- powers the sheet's "% founders" coverage metric on the hours report
  is_founder boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Coverage needed (was "Shift Slots"): one row per date per window.
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  shift_date date not null,
  -- window name shown on the board: Morning / Day / Afternoon / Evening, or
  -- anything for manual shifts (Maintenance, Private Event...). Free text on
  -- purpose — the sheet already needed ad-hoc labels.
  label text not null,
  starts_at time not null,
  ends_at time not null check (ends_at > starts_at),
  staff_needed smallint not null default 2 check (staff_needed between 0 and 20),
  -- 'momence' rows are created/updated by the sync-shifts cron (Phase 3);
  -- 'manual' rows are admin-entered and never touched by sync.
  source text not null default 'manual' check (source in ('momence', 'manual')),
  -- Momence session/appointment ids this window covers, e.g.
  -- [{"type": "session", "id": 123}] — lets re-syncs detect cancellations.
  momence_session_ids jsonb not null default '[]'::jsonb
    check (jsonb_typeof(momence_session_ids) = 'array'),
  -- set when an admin edits a momence-sourced shift; sync must not overwrite
  sync_locked boolean not null default false,
  notes text,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index shifts_date_idx on public.shifts (shift_date);

-- Who is working (was "Shift Log"): one row per person per shift. A person's
-- times can differ from the shift window (e.g. one hour of "setup" at the
-- start), so times are copied from the shift at creation and stay editable.
create table public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id) on delete cascade,
  staff_id uuid not null references public.schedule_staff (id),
  starts_at time not null,
  ends_at time not null check (ends_at > starts_at),
  -- the sheet's Role column: full = whole window, setup = opening hour(s),
  -- partial = anything else short of the full window
  role text not null default 'full' check (role in ('full', 'setup', 'partial')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shift_id, staff_id)
);

create index shift_assignments_staff_idx on public.shift_assignments (staff_id);

-- Unavailability (was "Blackouts"). Two kinds:
--   range:     start_date..end_date (trips, appointments)
--   recurring: days_of_week pattern, optionally bounded by start/end dates
--              (e.g. "Mon/Wed/Fri mornings, Aug–Dec")
-- Either kind may carry time bounds; no times means the whole day.
-- Entries auto-approve (decided 2026-08-04): they are live on creation, and
-- overlaps with existing assignments are surfaced as conflicts in the admin
-- UI rather than blocking the entry or silently unassigning anyone.
create table public.time_off (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.schedule_staff (id) on delete cascade,
  kind text not null check (kind in ('range', 'recurring')),
  start_date date,
  end_date date,
  check (kind != 'range' or (start_date is not null and end_date is not null)),
  check (end_date is null or start_date is null or end_date >= start_date),
  -- 0 = Sunday .. 6 = Saturday (matches JS Date.getDay())
  days_of_week smallint[] not null default '{}',
  check (kind != 'recurring' or array_length(days_of_week, 1) > 0),
  starts_at time,
  ends_at time,
  check ((starts_at is null) = (ends_at is null)),
  check (ends_at is null or ends_at > starts_at),
  note text,
  created_by text not null default 'admin' check (created_by in ('staff', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index time_off_staff_idx on public.time_off (staff_id);

-- App access is service-role (bypasses RLS); enabling RLS with admin-select
-- policies is forward-looking convention, same as the other tables.
alter table public.schedule_staff enable row level security;
alter table public.shifts enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.time_off enable row level security;

create policy "admins can select schedule staff"
  on public.schedule_staff for select to authenticated using (public.is_admin());
create policy "admins can select shifts"
  on public.shifts for select to authenticated using (public.is_admin());
create policy "admins can select shift assignments"
  on public.shift_assignments for select to authenticated using (public.is_admin());
create policy "admins can select time off"
  on public.time_off for select to authenticated using (public.is_admin());

create trigger schedule_staff_set_updated_at
  before update on public.schedule_staff
  for each row execute function public.set_updated_at();
create trigger shifts_set_updated_at
  before update on public.shifts
  for each row execute function public.set_updated_at();
create trigger shift_assignments_set_updated_at
  before update on public.shift_assignments
  for each row execute function public.set_updated_at();
create trigger time_off_set_updated_at
  before update on public.time_off
  for each row execute function public.set_updated_at();

-- Roster bootstrap: the seven people on the sheet's Staff tab. Emails are
-- filled in from /admin/schedule/staff once each person's Momence account
-- email is confirmed.
insert into public.schedule_staff (display_name, role, is_founder) values
  ('Wes', 'admin', true),
  ('Julien', 'admin', true),
  ('Sunny', 'staff', false),
  ('Sarah', 'staff', false),
  ('Omar', 'staff', false),
  ('Brian', 'staff', false),
  ('Althea', 'staff', false);
