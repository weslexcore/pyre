-- A form on a board.
--
-- A board can already take a card from outside: the intake endpoint turns
-- an HTTPS request into a card at the top of a pipeline. But somebody still
-- has to build the thing that makes that request. This gives a board its
-- own form — the manager picks which of the board's fields it asks, in what
-- order, which are required, and whether it asks everything on one page or
-- one question at a time — and the form writes the card itself.
--
-- One form per board, because a board is one kind of thing (a lead, a
-- request, a task) and its form asks for that thing. Two forms that file
-- onto one board would be two boards.
--
--   * access      — 'public' means anyone with the link; 'admin' means a
--                   signed-in dashboard user who can already see the board.
--   * layout      — 'single' is every question on one page; 'stepped' is
--                   one question per step with Back and Next.
--   * title_mode  — 'ask' puts a required Title question on the form;
--                   'template' builds the title from answers, so a public
--                   visitor is never asked to name a card on a board they
--                   cannot see ("Rental request from {contact_name}").
--   * questions   — the ordered list, as a document. A question is a pointer
--                   at a board field (by key) or at one of the card's own
--                   columns (title, notes, due_date), with an optional label
--                   and hint of its own and whether it is required. It has
--                   no identity beyond that pointer, nothing joins to it, and
--                   the builder saves it whole — the way columns and fields
--                   are already PATCHed as lists — so it lives in jsonb and
--                   is checked in the app (lib/boards/forms.ts) against the
--                   board's live fields at read time. A question naming a
--                   field that has since been archived is dropped there, the
--                   way board_cards.properties drops an unknown key, rather
--                   than refused here.
--
-- A card the form writes carries source = 'form', so a board can tell a
-- lead that came through its own form from one a webhook delivered.

begin;

create table public.board_forms (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null unique references public.boards (id) on delete cascade,
  -- Off until somebody switches it on; a form nobody has finished building
  -- should not be taking submissions.
  enabled boolean not null default false,
  access text not null default 'admin'
    check (access in ('public', 'admin')),
  layout text not null default 'single'
    check (layout in ('single', 'stepped')),
  title_mode text not null default 'ask'
    check (title_mode in ('ask', 'template')),
  title_template text not null default ''
    check (char_length(title_template) <= 300),
  -- Shown above the questions and after a submission. Plain text; blank
  -- lines separate paragraphs.
  intro text not null default ''
    check (char_length(intro) <= 2000),
  confirmation text not null default ''
    check (char_length(confirmation) <= 2000),
  submit_label text not null default 'Send'
    check (char_length(submit_label) between 1 and 40),
  -- [{ kind: 'field' | 'builtin', key, label, hint, required }], in order.
  questions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(questions) = 'array'),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A template title with nothing in it would name every card ''.
  constraint board_forms_template_has_text
    check (title_mode <> 'template' or length(btrim(title_template)) > 0)
);

comment on table public.board_forms is
  'The one form a board can put in front of people; a submission becomes a card in the board''s first open column.';
comment on column public.board_forms.access is
  'public: anyone with the link. admin: a signed-in dashboard user who can view the board.';
comment on column public.board_forms.layout is
  'single: every question on one page. stepped: one question per step.';
comment on column public.board_forms.title_mode is
  'ask: the form has a required Title question. template: the title is built from answers via title_template.';
comment on column public.board_forms.title_template is
  'Text with {field_key} placeholders, filled from the submission when title_mode = template.';
comment on column public.board_forms.questions is
  'Ordered list of { kind, key, label, hint, required }; validated in the app against the board''s live fields.';

create trigger board_forms_set_updated_at
  before update on public.board_forms
  for each row execute function public.set_updated_at();

alter table public.board_forms enable row level security;

-- App access is service-role (bypasses RLS) and gated in-route; these are
-- the convention the other board tables follow.
create policy "admins can select board forms"
  on public.board_forms for select using (public.is_admin());
create policy "admins can insert board forms"
  on public.board_forms for insert with check (public.is_admin());
create policy "admins can update board forms"
  on public.board_forms for update using (public.is_admin()) with check (public.is_admin());
create policy "admins can delete board forms"
  on public.board_forms for delete using (public.is_admin());

-- A card can now say it came in through the board's own form.
alter table public.board_cards drop constraint board_cards_source_check;
alter table public.board_cards
  add constraint board_cards_source_check
  check (source in ('manual', 'intake', 'form'));

comment on column public.board_cards.source is
  'manual: made in the admin. intake: delivered to the intake endpoint. form: submitted through the board''s form.';

commit;
