-- Guest profiles: what staff know about the people who come through the door.
--
-- Momence holds the account — name, email, bookings, purchases — and stays the
-- source of truth for all of it. What it has no room for is the part a good
-- attendant carries in their head: she likes the top bench and the sauna as
-- hot as it goes, he skips the plunge but drinks the whole kettle of tea, they
-- drove in from Charlottesville and come every other Sunday. This migration
-- gives that knowledge a home, keyed to the Momence member so it can sit next
-- to the account on /admin/guests and on the session roster.
--
-- Three tables:
--
--   * `guest_profile_fields` — the structured questions, configured by an
--                              admin on /admin/guests/fields rather than fixed
--                              in code. Heat, scents, plunge, drinks, wellness,
--                              local-or-visiting are seeded below; the point of
--                              a table is that the list can change on a
--                              Tuesday afternoon without a deploy.
--   * `guest_profiles`        — one row per Momence member, holding the answers
--                              (a jsonb map keyed by field key, so adding a
--                              field never alters this table) and a one-line
--                              summary for the roster.
--   * `guest_profile_notes`   — dated free-text observations, appended over
--                              time by whoever noticed something. This is the
--                              "extremely flexible" half: anything that does
--                              not fit a field goes here, with a name and a
--                              date on it.
--
-- Nothing here is ever shown to a guest. It is staff-facing context, and the
-- page that edits it is granted per person like every other admin tool.

create table public.guest_profile_fields (
  -- Stable machine key; the jsonb answers on guest_profiles are keyed by it,
  -- so it never changes once created (the label is what gets renamed).
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null check (length(label) between 1 and 60),
  -- text          free text, one line
  -- number        a number (a temperature, a count)
  -- yes_no        boolean
  -- choice        one of `options`
  -- multi_choice  any number of `options`
  kind text not null check (kind in ('text', 'number', 'yes_no', 'choice', 'multi_choice')),
  -- The answers offered for choice / multi_choice; empty for other kinds.
  options text[] not null default '{}',
  -- The heading the field appears under on the profile ("In the sauna",
  -- "Cold plunge"). Free text so admins can add a section by typing it.
  section text not null default 'About them' check (length(section) between 1 and 40),
  -- Help text under the label, for the person filling it in.
  hint text check (hint is null or length(hint) <= 200),
  -- Surfaced on the session roster next to the guest's name. Keep this to the
  -- few things worth knowing before they walk in; the profile has the rest.
  show_on_roster boolean not null default false,
  sort_order int not null default 0,
  -- Archived fields stop being asked but keep their answers readable: a
  -- profile filled in under last year's question list should still make sense.
  archived boolean not null default false,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index guest_profile_fields_order_idx
  on public.guest_profile_fields (archived, sort_order);

create table public.guest_profiles (
  id uuid primary key default gen_random_uuid(),
  -- The Momence member this is about. Text rather than bigint to match the
  -- booking rows (lost_found_notices.member_id), which carry it as a string.
  momence_member_id text not null unique,
  -- Cached from Momence when the profile is created or refreshed, so the
  -- profile list can be searched without a round trip. Momence stays
  -- authoritative; these are display copies.
  email text,
  name text,
  -- The one line a staff member should read before greeting them: "Regular
  -- on Tuesday evenings, comes with her sister, likes it quiet." Shown on the
  -- roster ahead of any field.
  summary text check (summary is null or length(summary) <= 500),
  -- field key -> answer. Shapes per kind: text -> string, number -> number,
  -- yes_no -> boolean, choice -> string, multi_choice -> string[]. Validated
  -- in the app against guest_profile_fields at write time; unknown keys are
  -- dropped there rather than rejected here so the schema stays open.
  field_values jsonb not null default '{}'::jsonb,
  -- Session emails, set by the route — never from a request body.
  created_by text not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The index page's default listing.
create index guest_profiles_updated_idx
  on public.guest_profiles (updated_at desc);

-- Roster joins fall back to email when a booking row carries no member id.
create index guest_profiles_email_idx
  on public.guest_profiles (email);

create table public.guest_profile_notes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.guest_profiles (id) on delete cascade,
  body text not null check (length(body) between 1 and 2000),
  -- Session email of whoever wrote it. Notes read best with a name and a
  -- date attached, and only the author (or an admin) may change one.
  author_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index guest_profile_notes_profile_idx
  on public.guest_profile_notes (profile_id, created_at desc);

alter table public.guest_profile_fields enable row level security;
alter table public.guest_profiles enable row level security;
alter table public.guest_profile_notes enable row level security;

-- App access is service-role (bypasses RLS) and gated in-route by
-- requirePage / hasGuestsManage; these policies are the forward-looking
-- convention the other admin tables follow.
create policy "admins can select guest profile fields"
  on public.guest_profile_fields for select
  using (public.is_admin());

create policy "admins can insert guest profile fields"
  on public.guest_profile_fields for insert
  with check (public.is_admin());

create policy "admins can update guest profile fields"
  on public.guest_profile_fields for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins can delete guest profile fields"
  on public.guest_profile_fields for delete
  using (public.is_admin());

create policy "admins can select guest profiles"
  on public.guest_profiles for select
  using (public.is_admin());

create policy "admins can insert guest profiles"
  on public.guest_profiles for insert
  with check (public.is_admin());

create policy "admins can update guest profiles"
  on public.guest_profiles for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins can delete guest profiles"
  on public.guest_profiles for delete
  using (public.is_admin());

create policy "admins can select guest profile notes"
  on public.guest_profile_notes for select
  using (public.is_admin());

create policy "admins can insert guest profile notes"
  on public.guest_profile_notes for insert
  with check (public.is_admin());

create policy "admins can update guest profile notes"
  on public.guest_profile_notes for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins can delete guest profile notes"
  on public.guest_profile_notes for delete
  using (public.is_admin());

-- The starting question list. Every one of these can be renamed, re-ordered,
-- archived, or given different options from /admin/guests/fields; they are
-- seeded so the tool is useful on day one rather than an empty form. The
-- keys are permanent (answers hang off them) — the labels are not.
insert into public.guest_profile_fields
  (key, label, kind, options, section, hint, show_on_roster, sort_order)
values
  ('heat', 'Heat', 'choice',
    array['Gentle', 'Medium', 'Hot', 'As hot as it goes'],
    'In the sauna', 'How hot they like the room.', true, 10),
  ('scents', 'Scents they enjoy', 'multi_choice',
    array['Eucalyptus', 'Lavender', 'Birch', 'Cedar', 'Citrus', 'Mint', 'Unscented'],
    'In the sauna', 'Essential oils for the löyly water.', true, 20),
  ('steam', 'Steam (water on the rocks)', 'choice',
    array['Loves the steam', 'Some', 'Keep it dry'],
    'In the sauna', null, false, 30),
  ('bench_spot', 'Favourite spot', 'choice',
    array['Top bench', 'Middle bench', 'Lower bench', 'Near the door'],
    'In the sauna', null, false, 40),
  ('cold_plunge', 'Cold plunge', 'choice',
    array['Skips it', 'Quick dip', 'Full plunge', 'Lives in it'],
    'Cold plunge', null, true, 50),
  ('plunge_temp', 'Plunge temperature', 'choice',
    array['Warmer tub', 'Either', 'Coldest tub'],
    'Cold plunge', 'Which tub they head for.', false, 60),
  ('drinks', 'Drinks they like', 'multi_choice',
    array['Still water', 'Sparkling water', 'Hot tea', 'Iced tea', 'Electrolytes', 'Kombucha'],
    'Drinks & extras', null, true, 70),
  ('wellness', 'Other wellness they enjoy', 'multi_choice',
    array['Yoga', 'Pilates', 'Running', 'Cycling', 'Strength training', 'Climbing',
          'Swimming', 'Breathwork', 'Meditation', 'Massage'],
    'Wellness', 'What else is part of their routine.', false, 80),
  ('lives', 'Local or visiting', 'choice',
    array['Lives nearby', 'Elsewhere in Richmond', 'Visiting from out of town'],
    'About them', null, true, 90),
  ('comes_with', 'Usually comes', 'choice',
    array['Solo', 'With a partner', 'With friends', 'In a group'],
    'About them', null, false, 100),
  ('conversation', 'Chatty or quiet', 'choice',
    array['Chatty', 'Quiet', 'Depends on the day'],
    'About them', 'Whether to strike up a conversation.', true, 110),
  ('reason', 'What brings them in', 'text', '{}',
    'About them', 'Recovery, stress, sleep, the social side, a ritual…', false, 120);

comment on table public.guest_profile_fields is
  'Admin-configured questions on a guest profile (/admin/guests/fields): kind, options, section, and whether the answer shows on the session roster. Keys are permanent; labels and options are not. Archived fields keep their answers readable.';
comment on table public.guest_profiles is
  'Staff-facing profile for one Momence member: a one-line summary plus answers to the configured fields, keyed by field key in field_values. Momence stays the source of truth for the account itself; name and email here are cached copies for search.';
comment on table public.guest_profile_notes is
  'Dated free-text observations about a guest, appended by staff over time. The flexible half of a profile: anything that does not fit a field.';
