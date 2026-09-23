-- Shift duties become an admin-editable list.
--
-- Until now the jobs a person could hold on a shift (Set Up (A), Host, Break
-- Down (B), …) were a fixed vocabulary: a TypeScript constant, a check
-- constraint on shift_assignments.duties / sub_requests.duties, and a zod enum
-- in the scheduler agent, all kept in sync by hand. This table replaces all
-- three. Admins add, rename, reorder, re-link and retire duties at
-- /admin/schedule/duties; the schedule board, the API, the weekly email, the
-- calendar feed, the Shift SOPs block and the scheduler agent read from it.
--
-- The duties[] arrays keep storing keys (text), so every existing assignment
-- stays valid untouched. Postgres can't put a foreign key on array elements,
-- so the old check constraints are dropped and the API validates against this
-- table on write instead.

create table public.shift_duties (
  -- Stable machine key stored in the duties[] arrays. Never changes once
  -- created — the label is what gets renamed.
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null check (length(label) between 1 and 40),
  -- What the duty actually covers ("Fire + Water"). Without it, "A" and "B"
  -- are unguessable at the moment someone is assigning them.
  detail text check (detail is null or length(detail) <= 60),
  -- Which part of the shift it belongs to; drives the picker's grouping and
  -- the canonical display order of a duties array.
  phase text not null check (phase in ('setup', 'session', 'breakdown')),
  -- The half of a split set-up / break-down this is. Whoever takes a side at
  -- set-up takes the same side at break down (advice on the board, never
  -- enforced here). Only set-up and break-down duties have a side.
  side text check (side in ('a', 'b')),
  -- The in-session duty the board adds when this half is taken — the A side
  -- (fire and water) falls to customer care, the B side (space, guest areas)
  -- to the host. A default only; admins change the mix per assignment.
  session_default text references public.shift_duties (key) on delete set null,
  -- The SOP that defines the duty; the board's chips and the Shift SOPs block
  -- link to it. Null leaves the duty assignable but unlinked.
  sop_id uuid references public.sops (id) on delete set null,
  sort_order int not null default 0,
  -- Archived duties stop being offered but stay readable on the assignments
  -- that already hold them.
  archived boolean not null default false,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shift_duties_side_phase_check
    check (side is null or phase in ('setup', 'breakdown')),
  constraint shift_duties_session_default_phase_check
    check (session_default is null or phase in ('setup', 'breakdown'))
);

comment on table public.shift_duties is
  'Admin-editable list of duties a shift assignment can hold (shift_assignments.duties stores the keys). Edited at /admin/schedule/duties.';

create index shift_duties_order_idx
  on public.shift_duties (archived, phase, sort_order);

-- One live duty per side of a phase, so "the matching half" is never ambiguous.
create unique index shift_duties_live_side_idx
  on public.shift_duties (phase, side)
  where side is not null and not archived;

-- Seed the six duties the schedule shipped with, linked to their SOPs by slug
-- (a missing SOP just leaves the link null). The session duties go in first
-- so the halves can reference them.
insert into public.shift_duties (key, label, detail, phase, side, session_default, sop_id, sort_order)
select v.key, v.label, v.detail, v.phase, v.side, v.session_default, s.id, v.sort_order
  from (values
    ('host',          'Host',          null::text, 'session', null::text, null::text, 'host-responsibilities',          2),
    ('customer_care', 'Customer Care', null,       'session', null,       null,       'customer-care-responsibilities', 3)
  ) as v (key, label, detail, phase, side, session_default, sop_slug, sort_order)
  left join public.sops s on s.slug = v.sop_slug;

insert into public.shift_duties (key, label, detail, phase, side, session_default, sop_id, sort_order)
select v.key, v.label, v.detail, v.phase, v.side, v.session_default, s.id, v.sort_order
  from (values
    ('setup_a',     'Set Up (A)',     'Fire + Water', 'setup',     'a', 'customer_care', 'set-up-a-fire-and-water',     0),
    ('setup_b',     'Set Up (B)',     'Space Prep',   'setup',     'b', 'host',          'set-up-b-space-prep',         1),
    ('breakdown_a', 'Break Down (A)', 'Fire + Water', 'breakdown', 'a', 'customer_care', 'break-down-a-fire-and-water', 4),
    ('breakdown_b', 'Break Down (B)', 'Guest Areas',  'breakdown', 'b', 'host',          'break-down-b-guest-areas',    5)
  ) as v (key, label, detail, phase, side, session_default, sop_slug, sort_order)
  left join public.sops s on s.slug = v.sop_slug;

-- The fixed vocabulary goes; the API validates against shift_duties instead.
alter table public.shift_assignments drop constraint if exists shift_assignments_duties_check;
alter table public.sub_requests drop constraint if exists sub_requests_duties_check;

comment on column public.shift_assignments.duties is
  'Keys of public.shift_duties this person holds, in canonical order (normalised by the API; no FK is possible on array elements).';
comment on column public.sub_requests.duties is
  'The assignment''s duties (public.shift_duties keys), snapshotted so the claim can recreate them.';

alter table public.shift_duties enable row level security;

-- App access is service-role (bypasses RLS) and gated in-route by
-- requirePage / requireScheduleManage; these policies follow the convention
-- the other admin tables use. Staff read the list (the board and their own
-- Shift SOPs need labels); only admins change it.
create policy "authenticated users can select shift duties"
  on public.shift_duties for select
  to authenticated
  using (true);

create policy "admins can insert shift duties"
  on public.shift_duties for insert
  with check (public.is_admin());

create policy "admins can update shift duties"
  on public.shift_duties for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins can delete shift duties"
  on public.shift_duties for delete
  using (public.is_admin());

grant all on table public.shift_duties to service_role;
grant select on table public.shift_duties to authenticated;
