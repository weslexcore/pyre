-- Staff-scheduling change log: an append-only audit trail of every mutation
-- to shifts, shift_assignments, time_off, and schedule_proposals, recording
-- who made the change (admin/staff by email, the scheduling agent, or the
-- Momence sync). Written best-effort from the apps/integrations API routes;
-- surfaced admin-only at /admin/schedule/changes.
--
-- Rows are never updated or deleted (no updated_at trigger on purpose) —
-- the log itself is the audit record.

create table public.schedule_changes (
  id uuid primary key default gen_random_uuid(),
  -- who: 'user' = a dashboard login (actor_email set), 'agent' = the
  -- scheduling agent's draft writer, 'system' = the hourly Momence sync
  actor_kind text not null check (actor_kind in ('user', 'agent', 'system')),
  actor_email text,
  -- display string for the log ("Wes McLaughlin", "Scheduling agent", ...)
  actor_label text not null,
  -- what was touched; 'sync' rows summarize one Momence sync run rather than
  -- a single row change
  entity_type text not null
    check (entity_type in ('shift', 'assignment', 'time_off', 'proposal', 'sync')),
  -- the touched row's id (null for sync summaries; deleted rows keep their id)
  entity_id uuid,
  action text not null check (
    action in (
      'create', 'update', 'delete',
      -- proposal lifecycle (propose = agent submitted a draft batch)
      'propose', 'approve', 'discard', 'accept_item', 'reject_item',
      'sync'
    )
  ),
  -- human-readable one-liner shown in the log ("Assigned Sunny to 'Morning'
  -- on 2026-08-14 (09:00–13:00)")
  summary text not null,
  -- structured before/after snapshots ({"before": {...}, "after": {...}})
  -- or sync counters; whatever helps reconstruct the change
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

-- The log is read newest-first with a created_at cursor.
create index schedule_changes_created_idx on public.schedule_changes (created_at desc);

-- App access is service-role (bypasses RLS); enabling RLS with an
-- admin-select policy is forward-looking convention, same as the other
-- scheduling tables. Select-only: nothing edits or deletes log rows.
alter table public.schedule_changes enable row level security;

create policy "admins can select schedule changes"
  on public.schedule_changes for select to authenticated using (public.is_admin());
