-- Standard operating procedures for the /admin/sops dashboard tool.
--
-- Two tables: `sops` holds the live document (title + markdown body + access
-- levels), `sop_versions` is the append-only history — one row per save,
-- recording who changed it, when, and the full snapshot, so the dashboard can
-- show a per-document audit trail and diff/restore any version.
--
-- Access is role-tiered per document, resolved against the existing `staff`
-- table at request time (is_admin > is_shift_lead > staff):
--   view_access — minimum role that may read the SOP
--   edit_access — minimum role that may save a new version
-- Admins always view and edit everything, and only admins create/archive SOPs
-- or change a document's access settings.

create table public.sops (
  id uuid primary key default gen_random_uuid(),
  -- URL identity (/admin/sops/<slug>); stable after creation.
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 1 and 200),
  -- Markdown body of the current version (denormalized from the latest
  -- sop_versions row so list/read paths never join).
  content_md text not null,
  -- Free-form grouping label for the index page ("Opening", "Closing", ...).
  category text not null default 'General' check (char_length(category) between 1 and 60),
  -- Minimum staff role required; 'staff' = anyone holding the page grant.
  view_access text not null default 'staff' check (view_access in ('staff', 'shift_lead', 'admin')),
  edit_access text not null default 'admin' check (edit_access in ('staff', 'shift_lead', 'admin')),
  -- Manual ordering within a category on the index page.
  sort_order integer not null default 0,
  -- Archived SOPs are hidden from non-admins; history is preserved.
  archived boolean not null default false,
  -- Version counter; matches the highest sop_versions.version for this row.
  current_version integer not null default 1,
  -- Emails of the sessions that created / last saved the document.
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger sops_set_updated_at
  before update on public.sops
  for each row execute function public.set_updated_at();

create table public.sop_versions (
  id uuid primary key default gen_random_uuid(),
  sop_id uuid not null references public.sops (id) on delete cascade,
  -- 1-based, monotonically increasing per document; the unique constraint is
  -- also the optimistic-concurrency guard for simultaneous saves.
  version integer not null check (version >= 1),
  title text not null,
  content_md text not null,
  -- Email of the person who saved this version (from the session, never the
  -- request body).
  edited_by text not null,
  -- Optional "what changed" note entered at save time.
  change_note text,
  created_at timestamptz not null default now(),
  unique (sop_id, version)
);

-- History panel reads newest-first per document.
create index sop_versions_sop_id_version_idx
  on public.sop_versions (sop_id, version desc);

alter table public.sops enable row level security;
alter table public.sop_versions enable row level security;

-- App access is service-role (bypasses RLS); these policies are
-- forward-looking convention, same as the other dashboard tables. Per-role
-- view filtering happens in the app layer where the Momence session email is
-- known, so the RLS floor is admin-only.
create policy "admins can select sops"
  on public.sops for select
  using (public.is_admin());

create policy "admins can insert sops"
  on public.sops for insert
  with check (public.is_admin());

create policy "admins can update sops"
  on public.sops for update
  using (public.is_admin());

create policy "admins can delete sops"
  on public.sops for delete
  using (public.is_admin());

create policy "admins can select sop versions"
  on public.sop_versions for select
  using (public.is_admin());

create policy "admins can insert sop versions"
  on public.sop_versions for insert
  with check (public.is_admin());

comment on table public.sops is
  'Standard operating procedures shown on /admin/sops. Markdown documents with per-document role-tiered view/edit access; full history in sop_versions.';
comment on table public.sop_versions is
  'Append-only save history for sops: one row per save with the full snapshot, the editor''s email, and an optional change note.';

-- ---------------------------------------------------------------------------
-- Seed: the two opening set-up checklists, imported as version 1 of each.
-- Dollar-quoted so the markdown needs no escaping.
-- ---------------------------------------------------------------------------

with seeded as (
  insert into public.sops
    (slug, title, content_md, category, view_access, edit_access, sort_order, created_by, updated_by)
  values
    (
      'set-up-a-fire-and-water',
      'Set Up (A) — Fire + Water',
      $sop_a$## Large Sauna

- [ ] Uncover wood + stage wood under anteroom bench
- [ ] Clear ash from inside sauna stove + tray into ash bucket
- [ ] Light fire using fatwood + propane torch
- [ ] Ensure sauna benches + floor are clean
- [ ] Wipe sauna glass

> **Ongoing:** check sauna progress / add wood throughout.

## Small Sauna

- [ ] Stage wood in firewood holder
- [ ] Set up chimney
- [ ] Clear ash from inside stove
- [ ] Light using fatwood + propane
- [ ] Ensure sauna benches + ground are clean
- [ ] Ensure roof of sauna is clear

## Plunges

*Refer to the cold plunge manual.*

- [ ] Ensure both are on + water level high enough
- [ ] Check plunge TA + pH + Cl and adjust accordingly
- [ ] Vacuum plunge + ensure filter basket and intakes are clear
- [ ] Bee season? Ensure bee baths have plunge water
- [ ] Re-cover plunges

## Deck

- [ ] Move + wipe down furniture
- [ ] Sweep or blow deck
- [ ] Scrub brush deck
- [ ] Normal event? — furniture, speakers, lights, towel holders on deck
- [ ] Special event? — stage deck items outside sauna
- [ ] Set out plunge timers

## Large Sauna (once cleared)

- [ ] Sweep / Swiffer / vacuum sauna anteroom once cleared
- [ ] Fill sauna bucket from shower

## Misc.

- [ ] Large session? — light fire pit
$sop_a$,
      'Opening',
      'staff',
      'admin',
      1,
      'seed',
      'seed'
    ),
    (
      'set-up-b-space-prep',
      'Set Up (B) — Space Prep',
      $sop_b$## Back of House

- [ ] Turn on garden hose
- [ ] Turn on shower propane
- [ ] Set up towel hamper in back of house
- [ ] Wipe privacy screens
- [ ] Wipe chairs + table near sauna

## Check-in / Changing

- [ ] Wipe mirror with spray and microfiber
- [ ] Wipe cubbies + changing + check-in with microfiber + spray
- [ ] Sweep changing + cubbies + check-in + step leading into space + sides of deck
- [ ] Scrub brush changing + check-in deck
- [ ] Hang up merch
- [ ] Hang curtains + set up wet bags, q-tips and hair ties + set up trash can
- [ ] Pull out candles + therma-cells
- [ ] Night session? — pull out lights
- [ ] Wellness event? — pull spare yoga mats out and ensure clean
- [ ] Pull out laundry hampers
- [ ] Pull fresh bag of towels as needed

## Social + Tech

- [ ] Blow as needed / pick up trash and litter around entire space
- [ ] Pull out social area cushions + wipe social area furniture
- [ ] Fill water dispenser at front desk / sauna
- [ ] Pull out drinks to cooler
- [ ] Set up WiFi + card reader + iPad + EcoFlow
- [ ] Fold towels under desk for session, keep extras in check-in storage bin
- [ ] Charge blower batteries if needed
$sop_b$,
      'Opening',
      'staff',
      'admin',
      2,
      'seed',
      'seed'
    )
  returning id, title, content_md
)
insert into public.sop_versions (sop_id, version, title, content_md, edited_by, change_note)
select id, 1, title, content_md, 'seed', 'Initial import'
from seeded;
