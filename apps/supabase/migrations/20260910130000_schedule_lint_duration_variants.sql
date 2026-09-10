-- Seed the two "missing length options" rules.
--
-- duration-variants (lib/schedule-lint/rules/duration-variants.ts) is a custom
-- rule template: it checks that every start time of one session type offers
-- each of a set of lengths, and reports the ones missing that would still fit
-- inside opening hours and clear of any special event. Two instances are what
-- the bathhouse actually sells, so they ship seeded rather than waiting to be
-- added by hand on /admin/schedule-lint:
--
--   * Open Hours — an hour and two hours at every start;
--   * Social — an hour, two, and three.
--
-- Only the settings that differ from the template are stored. `days` is left
-- out so both instances follow the opening hours in the rule's defaults;
-- editing either one on the page writes the full week back to that row.
--
-- Fixed uuids (the page generates one per rule) keep this insert idempotent:
-- re-running the migration will not add a second copy, and deleting a rule on
-- the page stays deleted.

insert into public.schedule_lint_rules (id, kind, label, enabled, params)
values
  (
    'd0a1e6c2-5f3b-4f8e-9c21-6b7a0d4e1f01',
    'duration-variants',
    'Open Hours lengths',
    true,
    '{"type": "open hours", "durations": [60, 120]}'::jsonb
  ),
  (
    'd0a1e6c2-5f3b-4f8e-9c21-6b7a0d4e1f02',
    'duration-variants',
    'Social lengths',
    true,
    '{"type": "social", "durations": [60, 120, 180]}'::jsonb
  )
on conflict (id) do nothing;
