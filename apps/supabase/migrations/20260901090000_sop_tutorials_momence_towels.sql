-- Tutorials for the SOP library: a tutorial is an ordinary sops row filed
-- under a 'Tutorials' section, so it is edited, versioned, and access-checked
-- like any other document — and any checklist item can link to it with
-- [name](/admin/sops/<slug>), which the admin UI opens in a peek modal
-- instead of navigating away mid-checklist.
--
-- Seeds the section, a stub "Enter dirty towels in Momence" tutorial (body is
-- placeholder headings for an admin to fill in), and links it from the
-- towel-hamper step of the two breakdown checklists as the worked example.
-- Every statement is guarded so a re-run is a no-op.

-- The Tutorials section, placed after the existing sections.
insert into public.sop_categories (name, sort_order)
select 'Tutorials', coalesce(max(sort_order), -1) + 1
from public.sop_categories
on conflict (name) do nothing;

-- Stub tutorial. Access columns are left at their defaults (viewable by every
-- role, editable by admins). Deliberately prose-only — no task lines — so it
-- never registers as a runnable checklist. The version row only lands when
-- the insert actually happened (returning is empty on conflict).
with seeded as (
  insert into public.sops
    (slug, title, content_md, category, sort_order, created_by, updated_by)
  values
    (
      'momence-dirty-towels',
      'Enter dirty towels in Momence',
      $towels$At the end of a shift, the dirty towel count goes into Momence so laundry orders track actual usage.

## TODO: Open the towel entry screen

Where in Momence this lives and what to tap to get there.

## TODO: Enter the count

What counts as a dirty towel (hamper vs. deck strays) and where the number goes.

## TODO: Confirm and double-check

How to verify the entry saved, and what to do if a count was entered wrong.
$towels$,
      'Tutorials',
      0,
      'seed',
      'seed'
    )
  on conflict (slug) do nothing
  returning id, title, content_md
)
insert into public.sop_versions (sop_id, version, title, content_md, edited_by, change_note)
select id, 1, title, content_md, 'seed', 'Initial import'
from seeded;

-- Link the towel-hamper step of the combined breakdown checklist to the
-- tutorial, recorded as a normal versioned save. replace() targets the shared
-- prefix so the two documents' differing suffixes survive; the guards skip
-- documents that were hand-edited past recognition or already linked. The
-- edit changes no task count or order, so open runs are unaffected.
with updated as (
  update public.sops
  set
    content_md = replace(
      content_md,
      '- [ ] Clear towel hampers',
      '- [ ] [Clear towel hampers](/admin/sops/momence-dirty-towels)'
    ),
    current_version = current_version + 1,
    updated_by = 'seed'
  where slug = 'break-down'
    and content_md like '%- [ ] Clear towel hampers%'
    and content_md not like '%(/admin/sops/momence-dirty-towels)%'
  returning id, title, content_md, current_version
)
insert into public.sop_versions (sop_id, version, title, content_md, edited_by, change_note)
select id, current_version, title, content_md, 'seed',
  'Linked the towel-hamper step to the Momence dirty-towels tutorial'
from updated;

-- Same link in the guest-areas breakdown checklist.
with updated as (
  update public.sops
  set
    content_md = replace(
      content_md,
      '- [ ] Clear towel hampers',
      '- [ ] [Clear towel hampers](/admin/sops/momence-dirty-towels)'
    ),
    current_version = current_version + 1,
    updated_by = 'seed'
  where slug = 'break-down-b-guest-areas'
    and content_md like '%- [ ] Clear towel hampers%'
    and content_md not like '%(/admin/sops/momence-dirty-towels)%'
  returning id, title, content_md, current_version
)
insert into public.sop_versions (sop_id, version, title, content_md, edited_by, change_note)
select id, current_version, title, content_md, 'seed',
  'Linked the towel-hamper step to the Momence dirty-towels tutorial'
from updated;
