-- Staff-proposed changes to their own arrive/leave times on a shift.
--
-- Someone on a shift who needs to come in early or stay late (or already
-- did) asks for new hours on their own assignment from /admin/schedule. The
-- assignment keeps its current hours until a schedule manager approves; the
-- approval writes the requested hours onto shift_assignments, so the hours
-- report picks them up from there. The request row stays as the paper
-- trail, like shift_requests.
--
-- Also seeds the 'hours_changes' switch in schedule_settings, so admins can
-- turn the employee-facing button off (a missing row reads as enabled).

create table public.hours_change_requests (
  id uuid primary key default gen_random_uuid(),
  -- the assignment whose hours would change; the request goes with it if
  -- the person is taken off the shift
  assignment_id uuid not null references public.shift_assignments (id) on delete cascade,
  -- denormalized from the assignment so the board can fetch by shift
  shift_id uuid not null references public.shifts (id) on delete cascade,
  staff_id uuid not null references public.staff (id) on delete cascade,
  -- the assignment's hours when the ask was made (what approval replaces)
  from_starts_at time not null,
  from_ends_at time not null,
  -- the hours they're asking for
  requested_starts_at time not null,
  requested_ends_at time not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  -- optional message from the requester ("stayed to finish laundry")
  note text,
  -- dashboard email of the manager/admin who decided; null while pending
  decided_by text,
  decided_at timestamptz,
  -- optional reason from the manager, emailed to the requester
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hours_change_requests_window_order
    check (requested_ends_at > requested_starts_at)
);

-- One open ask per assignment; a denied one may be re-made.
create unique index hours_change_requests_pending_uniq
  on public.hours_change_requests (assignment_id)
  where status = 'pending';
create index hours_change_requests_shift_idx on public.hours_change_requests (shift_id);
create index hours_change_requests_staff_idx on public.hours_change_requests (staff_id);

-- App access is service-role (bypasses RLS); enabling RLS with an
-- admin-select policy follows the other scheduling tables.
alter table public.hours_change_requests enable row level security;

create policy "admins can select hours change requests"
  on public.hours_change_requests for select to authenticated using (public.is_admin());

grant all on table public.hours_change_requests to service_role;

create trigger hours_change_requests_set_updated_at
  before update on public.hours_change_requests
  for each row execute function public.set_updated_at();

insert into public.schedule_settings (key, enabled) values ('hours_changes', true)
on conflict (key) do nothing;
