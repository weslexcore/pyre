-- Per-SOP access moves from a single minimum role to explicit grants: a set of
-- roles plus a set of named individuals, separately for viewing and editing.
--
-- The old model (`view_access` / `edit_access` holding one of staff <
-- shift_lead < admin, matched with >=) could only ever say "this tier and
-- everyone above it". There was no way to give one person access to a document
-- their role doesn't reach — the common case being a single staffer who owns a
-- procedure that is otherwise shift-lead-only.
--
-- Each document now carries four arrays:
--   view_roles  / edit_roles   — roles granted, as a set. Roles are disjoint
--                                buckets here, not tiers: 'staff' means people
--                                whose role is exactly staff, not "everyone".
--   view_emails / edit_emails  — individually granted staff emails, lowercase.
--
-- Access is the union: your role is granted, or you are named. Admins still
-- view and edit everything regardless, and an edit grant implies viewing (see
-- lib/sops/levels.ts) — under sets, an edit grant without a matching view
-- grant would otherwise be a silent no-op.

alter table public.sops
  -- Defaults mirror the old column defaults: readable by everyone holding the
  -- page grant, editable by admins only.
  add column view_roles text[] not null default array['staff', 'shift_lead', 'admin'],
  add column edit_roles text[] not null default array['admin'],
  add column view_emails text[] not null default array[]::text[],
  add column edit_emails text[] not null default array[]::text[];

-- Backfill: a tier becomes the set of roles that used to satisfy it, so every
-- existing document keeps exactly the audience it had.
--
-- This touches every row, and sops_set_updated_at would stamp all of them as
-- edited today — telling staff that every procedure changed the morning this
-- shipped. Re-describing who may read a document is not a content edit, so the
-- trigger sits out the backfill.
alter table public.sops disable trigger sops_set_updated_at;

update public.sops
set
  view_roles = case view_access
    when 'staff' then array['staff', 'shift_lead', 'admin']
    when 'shift_lead' then array['shift_lead', 'admin']
    else array['admin']
  end,
  edit_roles = case edit_access
    when 'staff' then array['staff', 'shift_lead', 'admin']
    when 'shift_lead' then array['shift_lead', 'admin']
    else array['admin']
  end;

alter table public.sops enable trigger sops_set_updated_at;

-- Only the three known roles, and a cap well above any real grant list so a
-- malformed request can't store an unbounded array.
alter table public.sops
  add constraint sops_view_roles_valid
    check (view_roles <@ array['staff', 'shift_lead', 'admin']::text[]),
  add constraint sops_edit_roles_valid
    check (edit_roles <@ array['staff', 'shift_lead', 'admin']::text[]),
  add constraint sops_view_emails_bounded
    check (coalesce(array_length(view_emails, 1), 0) <= 100),
  add constraint sops_edit_emails_bounded
    check (coalesce(array_length(edit_emails, 1), 0) <= 100);

-- The tiers are fully represented by the arrays now; leaving them would be a
-- second source of truth that the app no longer writes.
alter table public.sops
  drop column view_access,
  drop column edit_access;

comment on column public.sops.view_roles is
  'Roles granted read access, as a set (not a tier floor): staff, shift_lead, admin. Admins always read everything.';
comment on column public.sops.edit_roles is
  'Roles granted save access, as a set. An edit grant implies view access.';
comment on column public.sops.view_emails is
  'Individually granted staff emails (lowercase) that may read this SOP whatever their role.';
comment on column public.sops.edit_emails is
  'Individually granted staff emails (lowercase) that may save new versions, and therefore also read.';
