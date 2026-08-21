-- Give the two policy documents their own "Policies" section on /admin/sops.
-- Guest Policies and Staff Policies were seeded into "General" alongside the
-- Sauna Steward Philosophy, which buried the rules staff actually get asked
-- about behind a prose document. They are reference material rather than a
-- run-through, so the new category ranks directly under General, above the
-- shift-shaped ones (Opening, On Shift, Closing).
--
-- Moving a row fires sops_set_updated_at, so the cards will read "updated"
-- as of this migration; the version counter and updated_by are untouched,
-- since recategorizing is not a content edit.

insert into public.sop_categories (name, sort_order) values ('Policies', 1)
on conflict (name) do update set sort_order = 1;

update public.sop_categories set sort_order = 2 where name = 'Opening';
update public.sop_categories set sort_order = 3 where name = 'On Shift';
update public.sop_categories set sort_order = 4 where name = 'Closing';

-- Guest first: Staff Policies opens by deferring to it, so it only reads
-- correctly second.
update public.sops set category = 'Policies', sort_order = 0 where slug = 'guest-policies';
update public.sops set category = 'Policies', sort_order = 1 where slug = 'staff-policies';
