-- Where a form sends somebody once they have sent it.
--
-- A form was a dead end: the thank-you was a sentence on an otherwise empty
-- page, with nothing to do but close the tab. It ends in a button now.
-- Blank means the house default, which is the website's front door, so
-- every form built before this one leads somewhere too; a path is read
-- against this site, so a staff form can hand somebody on to a page of the
-- dashboard instead. What may be written there is checked in the app
-- (lib/boards/forms.ts isSafeHref): an https address or a path, and
-- nothing that could carry script to whoever clicks it.
--
-- Its own migration rather than a second pass over the notify/confetti one:
-- that version is already applied, and the CLI keys on the version number,
-- so anything added to it after the fact would never run.

begin;

alter table public.board_forms
  add column if not exists done_href text not null default ''
    check (char_length(done_href) <= 300),
  add column if not exists done_label text not null default ''
    check (char_length(done_label) <= 40);

comment on column public.board_forms.done_href is
  'Where the button under the thank-you goes; blank means the Pyre home page.';
comment on column public.board_forms.done_label is
  'What that button says; blank means a label naming where it goes.';

commit;
