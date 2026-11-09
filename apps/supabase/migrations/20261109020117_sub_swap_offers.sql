-- Shift swap offers on open sub requests (apps/integrations /admin/schedule).
--
-- Until now the only way to help a teammate who asked for a sub was to take
-- their shift outright. A swap offer is the second way: someone who is free
-- for the requested shift offers one of their own upcoming shifts in
-- exchange. The requester accepts or declines on the board (no manager step,
-- matching first-come-first-served claims); accepting exchanges the two
-- assignments and closes the sub request as claimed by the offerer.

-- One row per offer. The offerer's assignment window and duties are copied
-- here at offer time, for the same reason sub_requests snapshots them: the
-- original assignment row is deleted when the swap lands, and the requester's
-- new row is recreated from the snapshot. Only one PENDING offer per
-- (sub request, offerer) — a withdrawn or declined offer may be re-made.
create table public.sub_swap_offers (
  id uuid primary key default gen_random_uuid(),
  sub_request_id uuid not null references public.sub_requests (id) on delete cascade,
  offerer_staff_id uuid not null references public.staff (id) on delete cascade,
  offered_shift_id uuid not null references public.shifts (id) on delete cascade,
  -- the offerer's hours on the offered shift, snapshotted at offer time
  starts_at time not null,
  ends_at time not null check (ends_at > starts_at),
  -- the offerer's duties on the offered shift, snapshotted at offer time
  duties text[] not null default '{}',
  -- optional message to the requester ("I can do your Saturday if you take my Tuesday")
  note text,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index sub_swap_offers_pending_uniq
  on public.sub_swap_offers (sub_request_id, offerer_staff_id)
  where status = 'pending';
create index sub_swap_offers_sub_idx on public.sub_swap_offers (sub_request_id);
create index sub_swap_offers_offerer_idx on public.sub_swap_offers (offerer_staff_id);

-- The change log gains swap-offer rows.
alter table public.schedule_changes
  drop constraint schedule_changes_entity_type_check;
alter table public.schedule_changes
  add constraint schedule_changes_entity_type_check
    check (
      entity_type in (
        'shift', 'assignment', 'time_off', 'proposal', 'sync', 'request',
        'sub_request', 'agent_instructions', 'staff_prefs',
        'duty_assignment', 'duty_training', 'swap_offer'
      )
    );

-- App access is service-role (bypasses RLS); enabling RLS with an
-- admin-select policy is forward-looking convention, same as the other
-- scheduling tables.
alter table public.sub_swap_offers enable row level security;

create policy "admins can select sub swap offers"
  on public.sub_swap_offers for select to authenticated using (public.is_admin());

create trigger sub_swap_offers_set_updated_at
  before update on public.sub_swap_offers
  for each row execute function public.set_updated_at();
