-- Shift notes become shared by default, with an "admins only" switch.
--
-- Until now the log split by role: an admin read every note, everyone else
-- read only the notes they wrote (20260826120000_shift_notes_author_visibility).
-- From here a note is visible to everyone who holds /admin/shift-notes unless
-- whoever wrote it ticks "only admins can see this", in which case it stays
-- with the author and the admins as before. The author or an admin can flip
-- it either way later (/api/admin/shift-notes PATCH { adminOnly }).
--
-- Editing, deleting, replying, and triage do not change: editing and deleting
-- stay author-or-admin, replies stay a conversation between the author and the
-- admins, and status is still set by admins (lib/shift-notes/access). A shared
-- note's thread shows its non-private entries to everyone who can see the note.
--
-- Every note written before this was written under the old contract — its
-- author expected only the admins to read it — so existing rows are backfilled
-- admin-only, and only new notes default to shared.
--
-- The app reads with the service role, so the gate lives in the app; the RLS
-- policies stay admin-only like the other admin tables. knowledge_search
-- (the pyre-agents assistant's search) is the one place the database itself
-- applies the rule, so it is redefined below with the new predicate.

-- Existing rows take the column default at add time (true = admin only);
-- the default then flips so new notes are shared unless asked otherwise.
alter table public.shift_notes
  add column admin_only boolean not null default true;

alter table public.shift_notes
  alter column admin_only set default false;

comment on column public.shift_notes.admin_only is
  'When true, only admins and the author can see the note; when false, everyone who holds /admin/shift-notes can. Set by the author when writing it, changeable by the author or an admin.';

comment on table public.shift_notes is
  'Shift notes about how a shift went (/admin/shift-notes): free-text entries keyed by shift date, attributed to the session email. Anyone active on the roster may write one; a note is visible to everyone with the page unless marked admin_only, in which case only admins and its author see it. Editing and deleting are author-or-admin.';

comment on table public.shift_note_attachments is
  'Photos/video/documents attached to shift notes (/admin/shift-notes). Objects live in the private shift-note-media bucket and are served via signed URLs minted by /api/admin/shift-note-media, gated on the same rule as reading the note itself.';

-- knowledge_search, unchanged except for the shift-note predicate: with
-- p_shift_notes = 'mine' (a non-admin holding the page) the viewer now finds
-- shared notes as well as their own admin-only ones.
create or replace function public.knowledge_search(
  p_query text,
  p_role text default 'staff',
  p_email text default '',
  p_shift_notes text default null,
  p_incidents text default null,
  p_water boolean default false,
  p_limit integer default 12
)
returns table (
  source text,
  ref text,
  title text,
  category text,
  snippet text,
  rank real,
  happened_on date
)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select websearch_to_tsquery('english', coalesce(p_query, '')) as tsq
  ),
  viewer as (
    select
      coalesce(p_role, 'staff') as role,
      lower(btrim(coalesce(p_email, ''))) as email
  ),
  hits as (
    -- SOP library: title, category, and the markdown body.
    select
      'sop'::text as source,
      s.slug as ref,
      s.title,
      s.category,
      ts_headline(
        'english',
        s.content_md,
        q.tsq,
        'MaxFragments=2, MaxWords=30, MinWords=10, FragmentDelimiter= … , StartSel=[[, StopSel=]]'
      ) as snippet,
      ts_rank_cd(
        setweight(to_tsvector('english', s.title), 'A')
          || setweight(to_tsvector('english', s.category), 'B')
          || setweight(to_tsvector('english', s.content_md), 'C'),
        q.tsq
      ) as rank,
      s.updated_at::date as happened_on
    from public.sops s, q, viewer v
    where (
        v.role = 'admin'
        or (
          not s.archived
          and (
            v.role = any (s.view_roles)
            or v.role = any (s.edit_roles)
            or (
              v.email <> ''
              and (v.email = any (s.view_emails) or v.email = any (s.edit_emails))
            )
          )
        )
      )
      and (
        to_tsvector('english', s.title)
          || to_tsvector('english', s.category)
          || to_tsvector('english', s.content_md)
      ) @@ q.tsq

    union all

    -- Shift notes: the body of each write-up.
    select
      'shift_note'::text,
      n.id::text,
      'Shift notes for ' || to_char(n.note_date, 'FMMon FMDD, YYYY'),
      'Shift notes',
      ts_headline(
        'english',
        n.body,
        q.tsq,
        'MaxFragments=2, MaxWords=30, MinWords=10, FragmentDelimiter= … , StartSel=[[, StopSel=]]'
      ),
      ts_rank_cd(to_tsvector('english', n.body), q.tsq),
      n.note_date
    from public.shift_notes n, q, viewer v
    where p_shift_notes in ('all', 'mine')
      and (
        p_shift_notes = 'all'
        or not n.admin_only
        or (v.email <> '' and lower(n.author_email) = v.email)
      )
      and to_tsvector('english', n.body) @@ q.tsq

    union all

    -- Incident reports: the narrative fields only. affected_people and
    -- witnesses carry guest names and contact details and are never searched.
    select
      'incident'::text,
      i.reference,
      i.reference || ': ' || replace(i.category, '_', ' ')
        || ' (' || replace(i.severity, '_', ' ') || ')',
      'Incident reports',
      ts_headline(
        'english',
        concat_ws(' ', i.description, i.immediate_actions, i.follow_up_notes,
                  i.corrective_actions, i.resolution_notes),
        q.tsq,
        'MaxFragments=2, MaxWords=30, MinWords=10, FragmentDelimiter= … , StartSel=[[, StopSel=]]'
      ),
      ts_rank_cd(
        to_tsvector(
          'english',
          concat_ws(' ', i.description, i.immediate_actions, i.follow_up_notes,
                    i.corrective_actions, i.resolution_notes)
        ),
        q.tsq
      ),
      (i.occurred_at at time zone 'America/New_York')::date
    from public.incidents i, q, viewer v
    where p_incidents in ('all', 'mine')
      and (p_incidents = 'all' or lower(i.reported_by) = v.email)
      and i.status <> 'voided'
      and to_tsvector(
        'english',
        concat_ws(' ', i.description, i.immediate_actions, i.follow_up_notes,
                  i.corrective_actions, i.resolution_notes)
      ) @@ q.tsq

    union all

    -- Cold tub water log: only entries with free-text notes have anything to
    -- search; the readings themselves are served by the agent's log tool.
    select
      'water_test'::text,
      w.id::text,
      initcap(w.entry_type) || ', ' || w.tub || ' tub, '
        || to_char(w.created_at at time zone 'America/New_York', 'FMMon FMDD, YYYY'),
      'Cold tub water log',
      ts_headline(
        'english',
        w.notes,
        q.tsq,
        'MaxFragments=2, MaxWords=30, MinWords=10, FragmentDelimiter= … , StartSel=[[, StopSel=]]'
      ),
      ts_rank_cd(to_tsvector('english', w.notes), q.tsq),
      (w.created_at at time zone 'America/New_York')::date
    from public.water_tests w, q
    where p_water
      and w.notes is not null
      and to_tsvector('english', w.notes) @@ q.tsq
  )
  select h.source, h.ref, h.title, h.category, h.snippet, h.rank, h.happened_on
  from hits h
  order by h.rank desc, h.happened_on desc nulls last, h.title
  limit least(greatest(coalesce(p_limit, 12), 1), 50);
$$;

comment on function public.knowledge_search is
  'Ranked full-text search over SOPs, shift notes, incident narratives, and water log notes, filtered by the viewer''s dashboard access. Called by the pyre-agents knowledge assistant with a service-role key; the viewer parameters are the access rules, so never expose it to end-user roles.';

-- The function trusts its viewer parameters, so it must only be reachable
-- with the service-role key the agents app holds.
revoke all on function public.knowledge_search(text, text, text, text, text, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.knowledge_search(text, text, text, text, text, boolean, integer)
  to service_role;
