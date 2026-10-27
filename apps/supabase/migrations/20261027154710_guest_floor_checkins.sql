-- On the floor: when each guest checked in, so staff know who needs the
-- 15-minute warning.
--
-- Momence records *that* a booking was checked in (`checkedIn`) but not
-- *when*. The /admin/guests/floor page checks guests in through Momence's
-- check-in endpoint and keeps the time here, one row per booking. A guest
-- checked in some other way (the Momence app at the desk) has no row; the
-- page estimates their time from the session start until someone corrects
-- it, which writes a row.
--
-- Rows are small and only matter for a few hours. Nothing reads them after
-- the session ends, so there is no sweep; they are kept as a record.

create table public.guest_floor_checkins (
  -- Momence session booking id: one row per seat booked.
  booking_id text primary key check (booking_id ~ '^\d{1,20}$'),
  session_id text not null check (session_id ~ '^\d{1,20}$'),
  member_id text,
  checked_in_at timestamptz not null,
  -- How long this guest's session runs, in minutes. Null = the session's
  -- own length on the Momence schedule.
  session_minutes integer check (session_minutes between 5 and 600),
  -- When someone gave the 15-minute warning, so it isn't given twice.
  warned_at timestamptz,
  warned_by text,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.guest_floor_checkins is
  'Check-in time per Momence booking, recorded by /admin/guests/floor, which Momence does not keep. Drives the time-remaining bars and the 15-minute warning.';

create index guest_floor_checkins_session_idx
  on public.guest_floor_checkins (session_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- App access is service-role (bypasses RLS), gated in-route by the
-- /admin/guests page grant; these policies are the forward-looking
-- convention the other admin tables follow.
alter table public.guest_floor_checkins enable row level security;

create policy "admins can select guest floor checkins"
  on public.guest_floor_checkins for select
  using (public.is_admin());

create policy "admins can insert guest floor checkins"
  on public.guest_floor_checkins for insert
  with check (public.is_admin());

create policy "admins can update guest floor checkins"
  on public.guest_floor_checkins for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins can delete guest floor checkins"
  on public.guest_floor_checkins for delete
  using (public.is_admin());
