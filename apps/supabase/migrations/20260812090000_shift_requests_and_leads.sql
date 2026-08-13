-- Employee self-service scheduling, phase 2:
--   1. shift_requests — an employee asks to work a shift; an admin/manager
--      approves (creating the assignment) or denies. Managed from
--      /admin/schedule in apps/integrations.
--   2. sub_requests — an employee asks for a sub on a shift they're assigned
--      to: the date is logged as time off, admins are emailed, and every
--      available person gets a signed "I'll take it" link. First claim swaps
--      the assignment; the requester stays on until then.
--   3. schedule_settings — admin on/off switches for the employee-facing
--      actions (requesting shifts, requesting subs).
--   4. staff.is_shift_lead — people who can anchor a shift. Anyone without it
--      (and without is_founder) must be scheduled alongside a founder or a
--      shift lead; the boards surface shifts that break the rule.

-- Shift-lead flag on the roster. Founders count as leads implicitly, so the
-- seed founders don't need the flag set.
alter table public.staff
  add column is_shift_lead boolean not null default false;

-- One row per (shift, person) ask. Approving creates the shift_assignments
-- row; the request row is kept (status flipped) as the paper trail. Only one
-- OPEN ask per person per shift — a denied request may be re-made, so the
-- uniqueness is partial rather than a table constraint.
create table public.shift_requests (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id) on delete cascade,
  staff_id uuid not null references public.staff (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  -- optional message from the requester ("happy to just do setup", ...)
  note text,
  -- dashboard email of the manager/admin who decided; null while pending
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index shift_requests_pending_uniq
  on public.shift_requests (shift_id, staff_id)
  where status = 'pending';
create index shift_requests_shift_idx on public.shift_requests (shift_id);
create index shift_requests_staff_idx on public.shift_requests (staff_id);

-- A sub request: the requester wants off a shift they're assigned to. The
-- request logs their assigned hours as time off (time_off_id) and emails the
-- roster; the requester KEEPS the assignment until someone claims — the board
-- shows the time-off conflict as the "needs a sub" signal, and the shift
-- never silently loses coverage. Claiming swaps the assignment to the
-- claimer. The assignment window/role are copied here at request time so the
-- claim can recreate them after the original assignment row is deleted.
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

-- Admin on/off switches for the employee-facing schedule actions. Known keys
-- (validated in code, apps/integrations/src/lib/schedule/settings.ts):
--   shift_requests — employees may request open shifts
--   sub_requests — employees may request a sub for an assigned shift
-- A missing row reads as enabled; the rows are seeded below so the toggles
-- are explicit from day one.
create table public.schedule_settings (
  key text primary key,
  enabled boolean not null,
  -- dashboard email of the admin who last flipped it
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.schedule_settings (key, enabled) values
  ('shift_requests', true),
  ('sub_requests', true);

-- The change log gains request and sub-request rows ('deny' action — request
-- approvals reuse the existing 'approve').
alter table public.schedule_changes
  drop constraint schedule_changes_entity_type_check;
alter table public.schedule_changes
  add constraint schedule_changes_entity_type_check
    check (
      entity_type in (
        'shift', 'assignment', 'time_off', 'proposal', 'sync', 'request', 'sub_request'
      )
    );
alter table public.schedule_changes
  drop constraint schedule_changes_action_check;
alter table public.schedule_changes
  add constraint schedule_changes_action_check
    check (
      action in (
        'create', 'update', 'delete',
        'propose', 'approve', 'discard', 'accept_item', 'reject_item',
        'sync', 'deny'
      )
    );

-- App access is service-role (bypasses RLS); enabling RLS with admin-select
-- policies is forward-looking convention, same as the other scheduling tables.
alter table public.shift_requests enable row level security;
alter table public.sub_requests enable row level security;
alter table public.schedule_settings enable row level security;

create policy "admins can select shift requests"
  on public.shift_requests for select to authenticated using (public.is_admin());
create policy "admins can select sub requests"
  on public.sub_requests for select to authenticated using (public.is_admin());
create policy "admins can select schedule settings"
  on public.schedule_settings for select to authenticated using (public.is_admin());

create trigger shift_requests_set_updated_at
  before update on public.shift_requests
  for each row execute function public.set_updated_at();
create trigger sub_requests_set_updated_at
  before update on public.sub_requests
  for each row execute function public.set_updated_at();
create trigger schedule_settings_set_updated_at
  before update on public.schedule_settings
  for each row execute function public.set_updated_at();
