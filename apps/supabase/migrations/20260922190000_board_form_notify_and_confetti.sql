-- Who hears about a submission, and whether sending one is celebrated.
--
-- Until now a form's card woke everybody who holds the board: the right
-- default for the rental pipeline, where the community manager and the
-- founders are the whole audience, and too much for a board a dozen people
-- can open. A form can now name the people it wakes instead — addresses
-- from the roster, checked against the board's grants when the form is
-- saved and again when it sends, so a person who loses the board stops
-- hearing without anyone editing the form. An empty list keeps the old
-- behaviour, which is what every form that exists today has.
--
-- Confetti is the other half of the same idea, at the other end: a form
-- that is a small win to finish (a sign-up, a request) can say so. Off by
-- default, because an incident report is not a celebration.

begin;

alter table public.board_forms
  add column if not exists notify_emails text[] not null default '{}'
    check (array_length(notify_emails, 1) is null or array_length(notify_emails, 1) <= 20);

comment on column public.board_forms.notify_emails is
  'Roster addresses to notify when a submission lands; empty means everyone who can view the board.';

alter table public.board_forms
  add column if not exists confetti boolean not null default false;

comment on column public.board_forms.confetti is
  'Whether the form celebrates a submission with confetti on the thank-you.';

commit;
