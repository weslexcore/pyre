-- Live checklist runs (apps/integrations, /admin/sops). A run is shared per
-- document — two people splitting the opening checklist tick boxes on the
-- same run — but until now each screen learned of the other's ticks only on
-- its own next tap or a reload. Now every change to a run or its checks is
-- broadcast on the document's private Realtime channel, and each open
-- checklist refetches the run as it happens. The same channel carries
-- Presence, so the screens can also show who else has the checklist open
-- and which item they last touched.
--
-- Topics:
--   sop:<sop_id>   one per document: run started / finished / abandoned /
--                  discarded, and every item resolved or un-resolved.
--                  Listening (broadcast + presence) and publishing presence
--                  are allowed to whoever may view the document — the same
--                  rule the app applies (lib/sops/levels canViewSop), here as
--                  public.can_view_sop(uuid).
--   sops:runs      the run log and the library's in-progress strip: one
--                  message per run-level change, for anyone holding the SOPs
--                  page.
--
-- Broadcast from the database (AFTER triggers calling realtime.send()), so
-- the API routes, the hourly stale-run sweep, and an admin's delete are all
-- covered without touching their code; realtime.send() swallows its own
-- errors, so a Realtime outage never fails a write. Payloads carry only ids
-- and the kind of change — listeners refetch through the API, which keeps
-- the access rules in one place.

-- Whether the signed-in caller may read a document: admins always; everyone
-- else needs the SOPs page and, on an unarchived document, a role or named
-- grant (edit grants imply view, as in the app). Security definer so the
-- lookup reads sops/staff regardless of their own policies.
create or replace function public.can_view_sop(p_sop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_sop_id is null then false
    when public.is_admin() then true
    when not public.has_page('/admin/sops') then false
    else exists (
      select 1
      from public.sops s
      join public.staff st on st.id = public.current_staff_id()
      where s.id = p_sop_id
        and not s.archived
        and (
          (case when st.is_shift_lead then 'shift_lead' else 'staff' end)
            = any (s.view_roles || s.edit_roles)
          or st.email = any (s.view_emails || s.edit_emails)
        )
    )
  end;
$$;

comment on function public.can_view_sop(uuid) is
  'True when the signed-in caller may read this SOP: admin, or SOPs-page holder granted by role or by name (edit grants imply view). Mirrors lib/sops/levels canViewSop.';

-- The document id in a 'sop:<uuid>' Realtime topic, or null for any other
-- topic. A plain cast would raise on a malformed topic and fail the policy.
create or replace function public.sop_topic_id(p_topic text)
returns uuid
language sql
immutable
as $$
  select case
    when p_topic ~ '^sop:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then substring(p_topic from 5)::uuid
    else null
  end;
$$;

-- Run-level changes: a run started, completed, abandoned, or deleted
-- (discarded, or removed from the log).
create or replace function public.sop_runs_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record := coalesce(new, old);
  payload jsonb;
begin
  payload := jsonb_build_object(
    'kind', 'run',
    'op', tg_op,
    'run_id', r.id,
    'sop_id', r.sop_id,
    'status', case when tg_op = 'DELETE' then 'deleted' else r.status end,
    'actor', case when tg_op = 'DELETE' then null else coalesce(r.ended_by, r.started_by) end
  );
  perform realtime.send(payload, 'changed', 'sop:' || r.sop_id::text, true);
  perform realtime.send(payload, 'changed', 'sops:runs', true);
  return null;
end;
$$;

create trigger sop_runs_broadcast
  after insert or update of status or delete on public.sop_runs
  for each row execute function public.sop_runs_broadcast();

-- Item-level changes: a check resolved or un-resolved. The document comes
-- from the run; when a run is deleted its checks cascade after the run row
-- is gone, so that lookup finds nothing and the run's own DELETE broadcast
-- is the one that counts.
create or replace function public.sop_run_checks_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record := coalesce(new, old);
  v_sop_id uuid;
begin
  select sop_id into v_sop_id from public.sop_runs where id = r.run_id;
  if v_sop_id is null then
    return null;
  end if;
  perform realtime.send(
    jsonb_build_object(
      'kind', 'check',
      'op', tg_op,
      'run_id', r.run_id,
      'sop_id', v_sop_id,
      'item_index', r.item_index,
      'actor', r.checked_by
    ),
    'changed',
    'sop:' || v_sop_id::text,
    true
  );
  return null;
end;
$$;

create trigger sop_run_checks_broadcast
  after insert or update or delete on public.sop_run_checks
  for each row execute function public.sop_run_checks_broadcast();

-- Who may listen on a document's channel (its run broadcasts and the
-- presence of the people on it): whoever may view the document.
create policy "sop viewers receive run broadcasts and presence"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_view_sop(public.sop_topic_id(realtime.topic()))
  );

-- Who may announce themselves on it (Presence track): the same people.
-- Broadcast stays database-only — no client publishes a run change itself.
create policy "sop viewers publish presence"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and public.can_view_sop(public.sop_topic_id(realtime.topic()))
  );

-- The run log and the library strip: anyone holding the SOPs page.
create policy "sops page holders receive run log broadcasts"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'sops:runs'
    and public.has_page('/admin/sops')
  );
