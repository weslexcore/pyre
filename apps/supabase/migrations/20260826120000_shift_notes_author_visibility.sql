-- Shift notes become per-author. The log started as a shared feed for shift
-- leads: everyone who could open /admin/shift-notes read all of it. Two things
-- change:
--
--   1. Writing a note is everyone's job, not just the shift lead's — every
--      active person on the roster now reaches the page (the implicit grant
--      lives in the app, lib/auth/access).
--   2. Reading is no longer shared. An admin sees every note; everyone else
--      sees only the notes they wrote, and editing, deleting, and the media
--      hanging off a note follow the same line (lib/shift-notes/access).
--
-- The app reads these tables with the service role, so this migration carries
-- no functional change — it updates the table comments that document the
-- access model, so the schema stops describing the old shared-log contract.
-- The RLS policies below stay admin-only: they are the forward-looking
-- convention the other admin tables follow, and an admin is exactly who may
-- read the whole log under the new model too.

comment on table public.shift_notes is
  'Shift notes about how a shift went (/admin/shift-notes): free-text entries keyed by shift date, attributed to the session email. Anyone active on the roster may write one; admins read every note, everyone else only their own.';

comment on table public.shift_note_attachments is
  'Photos/video/documents attached to shift notes (/admin/shift-notes). Objects live in the private shift-note-media bucket and are served via signed URLs minted by /api/admin/shift-note-media, gated on the same rule as the note itself — author or admin.';
