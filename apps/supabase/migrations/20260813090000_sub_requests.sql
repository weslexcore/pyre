-- Sub requests: the "unable to work" button became "request a sub" (see
-- apps/integrations /admin/schedule). An employee asks for a sub on a shift
-- they're assigned to — the date is logged as time off, admins are emailed,
-- and everyone available that day gets a signed one-click claim link. The
-- requester keeps the assignment until the first claim swaps it over.
--
-- Also renames the 'unable_to_work' schedule setting (seeded by the
-- shift_requests_and_leads migration) to 'sub_requests', keeping whatever
-- enabled value an admin already chose.

-- One row per ask. The assignment window/role are copied here at request
-- time so the claim can recreate them after the original assignment row is
-- deleted; time_off_id links the blackout entry created with the request so
-- a cancel can remove it again. Only one OPEN ask per (shift, person) — a
-- cancelled request may be re-made, so the uniqueness is partial.
create table public.sub_requests (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id) on delete cascade,
  requester_staff_id uuid not null references public.staff (id) on delete cascade,
  starts_at time not null,
  ends_at time not null check (ends_at > starts_at),
  role text not null default 'full' check (role in ('full', 'setup', 'partial')),
  -- the blackout entry created with the request; cleared if that entry goes
  time_off_id uuid references public.time_off (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'claimed', 'cancelled')),
  claimed_by_staff_id uuid references public.staff (id),
  claimed_at timestamptz,
  -- how many available people were emailed a claim link
  notified_count smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index sub_requests_open_uniq
  on public.sub_requests (shift_id, requester_staff_id)
  where status = 'open';
create index sub_requests_shift_idx on public.sub_requests (shift_id);

-- Rename the setting, preserving the admin's chosen value. The insert-then-
-- delete shape stays safe even if 'sub_requests' somehow already exists.
insert into public.schedule_settings (key, enabled)
select 'sub_requests', enabled
  from public.schedule_settings
  where key = 'unable_to_work'
on conflict (key) do nothing;

delete from public.schedule_settings where key = 'unable_to_work';

-- The change log gains sub-request rows.
alter table public.schedule_changes
  drop constraint schedule_changes_entity_type_check;
alter table public.schedule_changes
  add constraint schedule_changes_entity_type_check
    check (
      entity_type in (
        'shift', 'assignment', 'time_off', 'proposal', 'sync', 'request', 'sub_request'
      )
    );

-- App access is service-role (bypasses RLS); enabling RLS with an
-- admin-select policy is forward-looking convention, same as the other
-- scheduling tables.
alter table public.sub_requests enable row level security;

create policy "admins can select sub requests"
  on public.sub_requests for select to authenticated using (public.is_admin());

create trigger sub_requests_set_updated_at
  before update on public.sub_requests
  for each row execute function public.set_updated_at();
