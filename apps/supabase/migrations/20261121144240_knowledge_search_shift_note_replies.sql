-- Pyre Agent's knowledge search finds shift notes by their replies.
--
-- knowledge_search matched a shift note on its body alone, so a question
-- answered in the thread ("where are the spare filters?" / "back closet,
-- top shelf") was invisible to the assistant. It now matches the note's
-- comments too, as the dashboard's own search and the log's filter do
-- (lib/shift-notes/search.ts). The same rules apply as reading the thread on
-- /admin/shift-notes:
--
--   * which notes: unchanged (20261015173001): admins every note; anyone
--     else holding the page the shared notes plus their own admin-only ones;
--   * which replies: comments only, never the thread's recorded events; a
--     private comment only for admins.
--
-- The function is otherwise unchanged; it is redefined whole because SQL
-- functions can't be patched in place. Its grants are restated at the end
-- (create or replace keeps them, but the file reads correctly on its own).

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

    -- Shift notes: the body of each write-up and the comments in its thread
    -- the viewer may read. A note is a conversation, and the answer someone
    -- is looking for is often a reply ("we keep the spare filters in the
    -- back closet"). Only comments count; the thread's events (status
    -- changes, edits, classifications) are not text anyone wrote. A private
    -- comment is the admins' alone (p_shift_notes = 'all').
    select
      'shift_note'::text,
      n.id::text,
      'Shift notes for ' || to_char(n.note_date, 'FMMon FMDD, YYYY'),
      'Shift notes',
      ts_headline(
        'english',
        concat_ws(E'\n', n.body, t.replies),
        q.tsq,
        'MaxFragments=2, MaxWords=30, MinWords=10, FragmentDelimiter= … , StartSel=[[, StopSel=]]'
      ),
      ts_rank_cd(
        setweight(to_tsvector('english', n.body), 'A')
          || setweight(to_tsvector('english', coalesce(t.replies, '')), 'B'),
        q.tsq
      ),
      n.note_date
    from public.shift_notes n
    cross join q
    cross join viewer v
    left join lateral (
      select string_agg(r.body, E'\n' order by r.created_at) as replies
      from public.shift_note_replies r
      where r.note_id = n.id
        and r.kind = 'comment'
        and (p_shift_notes = 'all' or not r.is_private)
    ) t on true
    where p_shift_notes in ('all', 'mine')
      and (
        p_shift_notes = 'all'
        or not n.admin_only
        or (v.email <> '' and lower(n.author_email) = v.email)
      )
      and (
        to_tsvector('english', n.body) @@ q.tsq
        or to_tsvector('english', coalesce(t.replies, '')) @@ q.tsq
      )

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
  'Ranked full-text search over SOPs, shift notes (and the comments on them the viewer may read), incident narratives, and water log notes, filtered by the viewer''s dashboard access. Called by the pyre-agents knowledge assistant with a service-role key; the viewer parameters are the access rules, so never expose it to end-user roles.';

-- The function trusts its viewer parameters, so it must only be reachable
-- with the service-role key the agents app holds.
revoke all on function public.knowledge_search(text, text, text, text, text, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.knowledge_search(text, text, text, text, text, boolean, integer)
  to service_role;
