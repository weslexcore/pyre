-- Files on a card's comments: the photo of the broken heater beside "it's
-- doing it again", the signed quote beside "sent back today".
--
-- They are board_attachments rows like the files a `files` field holds —
-- the same private board-media bucket, the same signed-URL reads behind the
-- board's grant, the same staging and hourly sweep — told apart by what
-- they belong to:
--
--   * field_key — now null for a comment's file. A `files` answer only ever
--                 names rows uploaded for its own field (filterFileAnswers),
--                 so a comment's file can never be pulled into an answer.
--   * event_id  — the comment (board_events, action 'comment') the file was
--                 posted with; null while staged and for a field's files.
--                 The composer uploads the moment a file is picked, and the
--                 comment claims its staged rows when it is posted, setting
--                 card_id and event_id together.
--
-- And a comment may be files with no words, so the rule that a comment has
-- a note now also accepts one that records the files it carries.
--
-- A comment's files go with its card: card_id cascades the rows, and the card
-- route removes the objects first (deleteCardAttachments), as for a field's.

begin;

alter table public.board_attachments
  alter column field_key drop not null,
  add column event_id uuid references public.board_events (id) on delete cascade,
  -- A file answers a field or belongs to a comment, never both; a claimed
  -- comment file names its card as well as its comment.
  add constraint board_attachments_owner_check
    check (event_id is null or (field_key is null and card_id is not null));

-- A card's thread lists each comment's files.
create index board_attachments_event_idx
  on public.board_attachments (event_id, created_at)
  where event_id is not null;

-- A comment may now be files alone. It still has to carry something: words,
-- or the count of files it was posted with (detail.files), which the app
-- writes only after checking the files are there to claim.
alter table public.board_events
  drop constraint board_events_comment_has_note;
alter table public.board_events
  add constraint board_events_comment_has_note
    check (
      action <> 'comment'
      or length(btrim(coalesce(note, ''))) > 0
      or coalesce((detail ->> 'files')::int, 0) > 0
    );

comment on column public.board_attachments.field_key is
  'The board_fields.key of the files field this answers; null for a file posted with a comment.';
comment on column public.board_attachments.event_id is
  'The comment (board_events) this file was posted with; null while staged and for a field''s files.';

commit;
