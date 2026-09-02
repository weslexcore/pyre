-- Full-text search across the staff knowledge base, for the pyre-agents
-- knowledge assistant ("What are the benefits of cold plunging?").
--
-- One function ranks hits from every source staff can read from the admin
-- dashboard and returns them as a single list:
--
--   * sops          — the SOP library (title, category, markdown body)
--   * shift_notes   — shift write-ups (body)
--   * incidents     — incident report narratives (never the people fields)
--   * water_tests   — cold tub water log entries that carry free-text notes
--
-- The caller is the agent's service-role client, which bypasses RLS, so the
-- function applies the dashboard's own visibility rules itself from the
-- viewer parameters the integrations app resolves for the staff member who
-- asked:
--
--   p_role / p_email  — SOP grants (lib/sops/levels.ts canViewSop): admins see
--                       everything including archived documents; everyone
--                       else needs their role or their email on the view or
--                       edit grants of a non-archived document.
--   p_shift_notes     — 'all' (admins), 'mine' (own notes only), or null
--                       (no shift-notes access).
--   p_incidents       — 'all' (incidents:manage), 'mine' (reports they
--                       filed), or null. Voided reports never match.
--   p_water           — whether the viewer holds the /admin/water page.
--
-- Ranking is Postgres ts_rank_cd over the English configuration, so stems
-- match ("plunging" finds "plunge", "benefits" finds "benefit"). SOP titles
-- outweigh categories outweigh body text. Snippets come from ts_headline
-- with [[ ]] around the matched words; the agent strips markdown from them.
--
-- The corpus is a few dozen documents and a few hundred log rows, so the
-- tsvectors are computed per query rather than indexed. Add generated
-- tsvector columns with GIN indexes if shift notes or incidents ever grow
-- into the tens of thousands.

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
      and (p_shift_notes = 'all' or lower(n.author_email) = v.email)
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
