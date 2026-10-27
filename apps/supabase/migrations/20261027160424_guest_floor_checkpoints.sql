-- On the floor: any number of check-ins per guest, not one warning.
--
-- The first version tracked a single 15-minute warning (warned_at /
-- warned_by). Staff now configure the moments they check on a guest on
-- /admin/settings (`floor.checkpoints`: "15-minute warning, 15 min before
-- their session ends", "Water, 20 min after they arrive", ...), and the floor
-- page marks each one done per guest. Those marks live in one jsonb column
-- keyed by the check-in's id:
--
--   { "<checkpoint id>": { "at": "<timestamptz>", "by": "<email>" } }
--
-- A mark whose check-in has since been removed from settings is ignored by
-- the app, not cleaned up here.
--
-- The warned_* columns are dropped rather than carried: the table shipped in
-- the same release and holds no warnings worth keeping.

alter table public.guest_floor_checkins
  add column checkpoints_done jsonb not null default '{}'::jsonb
    check (jsonb_typeof(checkpoints_done) = 'object');

comment on column public.guest_floor_checkins.checkpoints_done is
  'Check-ins marked done for this guest, keyed by the floor.checkpoints id from app settings: { id: { at, by } }.';

alter table public.guest_floor_checkins
  drop column warned_at,
  drop column warned_by;
