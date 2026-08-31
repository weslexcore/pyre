-- Staged shift-note attachments: the composer now uploads files eagerly,
-- while the note is still being written, so an attachment row may briefly
-- exist with no note. A null note_id means "uploaded, not yet claimed";
-- creating the note claims its staged rows by setting note_id. Unclaimed
-- rows older than a day are swept opportunistically by the notes route.
-- Objects for staged uploads live under shift-notes/staging/ and keep that
-- key after claiming — storage_path is opaque, nothing depends on its shape.

alter table public.shift_note_attachments
  alter column note_id drop not null;

-- The sweep and the per-uploader staging cap both scan unclaimed rows.
create index shift_note_attachments_staged_idx
  on public.shift_note_attachments (uploaded_by, created_at)
  where note_id is null;

comment on column public.shift_note_attachments.note_id is
  'Owning note; null while staged (uploaded from the composer before the note exists).';
