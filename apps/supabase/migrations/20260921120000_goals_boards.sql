-- Goals, KPIs, and the boards their tasks live on.
--
-- Wes and Julien have been running the company out of a Trello board: five
-- lists, seventy-odd cards, nine labels, and no way to answer the questions
-- they actually ask each other on a Monday — how does this card move the
-- needle, who is on what, what is late, what got finished. This migration
-- replaces that with a smaller idea: **a goal is the unit of work.**
--
-- You write down a goal ("train the staff to run the space without our
-- intervention by March"), hang the KPIs on it that say what "met" means,
-- and every task that advances it rolls up to it. When the numbers say the
-- goal is met, a founder marks it completed by hand — nothing here ever
-- closes a goal because a task counter hit zero. A goal can nest one level
-- deep, so a long-term goal can roll up the midterm ones under it.
--
-- Tasks are cards on a board, because the founders' task list and the lead
-- pipelines they want next (private rentals, group bookings, today just a
-- mailto link on the landing page) are the same shape with different
-- columns. So:
--
--   * `goals`         — the goal itself: status, owner, target date, an
--                       optional parent, and how it was called complete.
--   * `goal_kpis`     — the numbers the goal is judged on. Measured by hand
--                       for now (`source` is reserved so a KPI can later read
--                       a live number out of Momence or PostHog instead).
--   * `boards`        — a column layout with a name. `goals` (seeded) is the
--                       founders' task board; `rentals` (seeded) is the first
--                       lead pipeline.
--   * `board_columns` — the columns of one board, each with a `kind` that
--                       says whether sitting there means finished.
--   * `board_fields`  — per-board questions, modeled on guest_profile_fields:
--                       a lead board wants a contact email and a party size;
--                       the task board wants neither.
--   * `board_cards`   — a task or a lead. Optionally filed under a goal.
--   * `board_events`  — the audit trail and comment thread for both.
--
-- Access is the usual per-page grant, with one addition the community manager
-- needs: `board:<slug>` in a staff row's `pages` opens exactly one board and
-- nothing else — the founders' goals stay invisible to whoever is working the
-- rental pipeline. That key is interpreted in the app (adminTools.ts); no
-- column here knows about it.
--
-- No Trello import. They start empty on purpose.

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  -- One level of nesting only: a long-term goal rolls up the midterm goals
  -- under it. `restrict` rather than cascade because deleting a parent must
  -- never silently take its children with it; the route refuses and asks you
  -- to re-file them. Depth is enforced in the app (lib/goals/access.ts) —
  -- Postgres has no cheap way to say "no grandparents".
  parent_id uuid references public.goals (id) on delete restrict,
  title text not null check (length(btrim(title)) > 0 and char_length(title) <= 200),
  description_md text not null default '' check (char_length(description_md) <= 20000),
  -- planned    written down, not started
  -- active     being worked on
  -- completed  a founder decided it was met (see completion_note)
  -- dropped    deliberately abandoned; kept so the reasoning survives
  status text not null default 'planned'
    check (status in ('planned', 'active', 'completed', 'dropped')),
  -- Who is driving it. Null is honest for a goal nobody has picked up yet.
  owner_email text check (char_length(owner_email) between 3 and 320),
  -- One of the nine areas carried over from the Trello labels (Operations,
  -- Marketing, Experience, …). Free text so the list can change in code
  -- without a migration.
  area text check (char_length(area) <= 40),
  -- Set once, the first time the goal goes active; never overwritten by a
  -- later status flip, so "how long has this been running" stays true.
  started_at timestamptz,
  -- The date it is meant to be met by, for the pace chip and the overdue
  -- strip. A date, not a timestamp: goals land on days.
  target_date date,
  sort_order integer not null default 0,
  completed_at timestamptz,
  completed_by text,
  -- What was true when it was called met: "staff ran four consecutive weeks
  -- with no founder on site; the shift-lead KPI is short but that is fine."
  -- The KPI numbers alone never tell the whole story.
  completion_note text check (char_length(completion_note) <= 2000),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goals_completion_attributed
    check ((completed_at is null) = (completed_by is null)),
  -- Completion is the one status that carries a timestamp, and it always
  -- carries one — so "completed" can never be a status with no date behind it.
  constraint goals_completed_has_timestamp
    check ((status = 'completed') = (completed_at is not null))
);

-- The index page: top-level goals in order, children under their parent.
create index goals_tree_idx on public.goals (parent_id, sort_order, created_at);

-- "What is active and when is it due" — the pace and overdue reads.
create index goals_status_target_idx on public.goals (status, target_date);

create trigger goals_set_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

create table public.goal_kpis (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0 and char_length(name) <= 120),
  -- "weeks", "%", "$", "bookings" — rendered after the number, never parsed.
  unit text check (char_length(unit) <= 20),
  -- at_least  higher is better; met once current >= target
  -- at_most   lower is better; met once current <= target
  direction text not null check (direction in ('at_least', 'at_most')),
  -- Where the number stood when the goal was written. The progress meter
  -- scales start -> target, so a KPI that starts at 3 of 4 does not read as
  -- 75% done on day one.
  start_value numeric,
  target_value numeric not null,
  -- Null until somebody measures it. Not the same as zero.
  current_value numeric,
  -- Reserved. Every KPI is hand-measured today; the column exists so a later
  -- version can set 'momence:memberships' or 'posthog:signups' and have the
  -- number refresh itself without moving every row to a new table.
  source text not null default 'manual' check (source in ('manual')),
  -- When current_value was last set, and by whom — so the UI can say
  -- "measured 12 days ago" and a stale number stops being mistaken for news.
  measured_at timestamptz,
  measured_by text,
  sort_order integer not null default 0,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goal_kpis_measurement_attributed
    check ((measured_at is null) = (measured_by is null))
);

create index goal_kpis_goal_idx on public.goal_kpis (goal_id, sort_order);

create trigger goal_kpis_set_updated_at
  before update on public.goal_kpis
  for each row execute function public.set_updated_at();

create table public.boards (
  id uuid primary key default gen_random_uuid(),
  -- Appears in the URL (/admin/boards/rentals) and in the grant key
  -- (board:rentals), so it is permanent once issued — renaming the board
  -- renames `name`, not this.
  slug text not null unique check (slug ~ '^[a-z][a-z0-9-]{1,39}$'),
  name text not null check (length(btrim(name)) > 0 and char_length(name) <= 60),
  description text not null default '' check (char_length(description) <= 500),
  -- What one card is called here: a 'task' on the goals board, a 'lead' on
  -- the rentals board. Used in buttons and empty states.
  card_noun text not null default 'task' check (char_length(card_noun) between 1 and 20),
  -- Whether this board's cards belong on /admin/goals/tasks. True for work
  -- the founders owe; false for a pipeline, where forty open leads would
  -- drown the twelve things that actually need doing this week.
  include_in_all_tasks boolean not null default true,
  sort_order integer not null default 0,
  archived boolean not null default false,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index boards_order_idx on public.boards (archived, sort_order, name);

create trigger boards_set_updated_at
  before update on public.boards
  for each row execute function public.set_updated_at();

create table public.board_columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  -- Stable machine key, like guest_profile_fields.key: the label is what gets
  -- renamed. Unique per board.
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null check (length(btrim(label)) > 0 and char_length(label) <= 40),
  -- open     in flight
  -- done     finished well (sets completed_at on the cards that land here)
  -- dropped  finished badly — a lost lead, an abandoned task
  kind text not null check (kind in ('open', 'done', 'dropped')),
  sort_order integer not null default 0,
  -- Columns are archived, never deleted, so the cards that passed through one
  -- keep a column to point at.
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (board_id, key)
);

create index board_columns_board_idx on public.board_columns (board_id, sort_order);

create trigger board_columns_set_updated_at
  before update on public.board_columns
  for each row execute function public.set_updated_at();

create table public.board_fields (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  -- Permanent: board_cards.properties is keyed by it.
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null check (length(btrim(label)) > 0 and char_length(label) <= 60),
  -- Same kinds as guest_profile_fields, plus `date` — a lead almost always
  -- has a requested date on it.
  kind text not null
    check (kind in ('text', 'number', 'yes_no', 'choice', 'multi_choice', 'date')),
  options text[] not null default '{}',
  hint text check (char_length(hint) <= 200),
  -- Whether the answer rides along on the card in the column view, or waits
  -- inside the card. A pipeline column is narrow; two or three fields fit.
  show_on_card boolean not null default false,
  sort_order integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (board_id, key)
);

create index board_fields_board_idx on public.board_fields (board_id, archived, sort_order);

create trigger board_fields_set_updated_at
  before update on public.board_fields
  for each row execute function public.set_updated_at();

create table public.board_cards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  -- The column the card sits in; its kind (open/done/dropped) is what
  -- "finished" means. Must belong to board_id (checked in the route).
  column_id uuid not null references public.board_columns (id) on delete restrict,
  -- The goal this card advances; null for an unfiled chore or a lead.
  goal_id uuid references public.goals (id) on delete set null,
  title text not null check (length(btrim(title)) > 0 and char_length(title) <= 300),
  notes_md text not null default '' check (char_length(notes_md) <= 20000),
  -- Staff email, lowercased by the route; null while unowned.
  owner_email text check (char_length(owner_email) between 3 and 320),
  -- Wall-clock date in America/New_York, like shift_notes.note_date.
  due_date date,
  -- "Waiting on Declan's callback": the card stays in progress, the badge
  -- says why. This is what Trello's Waiting list was for, without the column.
  waiting_on text check (char_length(waiting_on) <= 120),
  area text check (char_length(area) <= 40),
  sort_order integer not null default 0,
  -- Answers to this board's board_fields, keyed by field key. Validated in
  -- the app against the field list at write time; unknown keys are dropped
  -- there rather than rejected here, so the schema stays open.
  properties jsonb not null default '{}'::jsonb,
  source text not null default 'manual' check (source in ('manual', 'intake')),
  -- Caller-supplied idempotency key for intake; re-delivery updates, never
  -- duplicates. Null for anything typed in by a person.
  external_ref text check (char_length(external_ref) <= 200),
  completed_at timestamptz,
  completed_by text,
  -- Session email, or 'intake'; never the request body.
  created_by text not null check (char_length(created_by) between 3 and 320),
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint board_cards_completion_attributed
    check ((completed_at is null) = (completed_by is null))
);

-- One card per (board, external_ref): the same web form submission delivered
-- twice lands in one card.
create unique index board_cards_external_ref_uniq
  on public.board_cards (board_id, external_ref) where external_ref is not null;

-- The column view's read: one board, in column and hand order.
create index board_cards_board_idx
  on public.board_cards (board_id, column_id, sort_order, created_at);

-- Everything rolled up under one goal.
create index board_cards_goal_idx on public.board_cards (goal_id) where goal_id is not null;

-- All Tasks: what each person still owes, and what is due or late. Partial on
-- open cards, because the done pile only ever grows and is never scanned this
-- way.
create index board_cards_owner_open_idx
  on public.board_cards (owner_email) where completed_at is null;
create index board_cards_due_open_idx
  on public.board_cards (due_date) where completed_at is null and due_date is not null;

-- "Recently done", newest first.
create index board_cards_completed_idx
  on public.board_cards (completed_at desc) where completed_at is not null;

create trigger board_cards_set_updated_at
  before update on public.board_cards
  for each row execute function public.set_updated_at();

create table public.board_events (
  id uuid primary key default gen_random_uuid(),
  -- Exactly one subject: an event is about a goal or about a card.
  goal_id uuid references public.goals (id) on delete cascade,
  card_id uuid references public.board_cards (id) on delete cascade,
  -- created / updated / status_changed / assigned / due_changed / moved —
  -- the mechanical trail. kpi_updated carries { kpi_id, name, from, to }.
  -- completed carries the completion preview a founder confirmed against.
  -- comment is the only one a person writes: `note` holds what they said.
  action text not null check (action in (
    'created', 'updated', 'status_changed', 'assigned', 'due_changed',
    'moved', 'kpi_updated', 'completed', 'comment'
  )),
  -- Session email of whoever did it, or 'intake' for the public endpoint.
  actor text not null,
  -- { field: { from, to } } for the mechanical actions.
  detail jsonb not null default '{}'::jsonb,
  note text check (char_length(note) <= 4000),
  created_at timestamptz not null default now(),
  constraint board_events_one_subject
    check ((goal_id is null) <> (card_id is null)),
  -- A comment with nothing in it is not a comment.
  constraint board_events_comment_has_note
    check (action <> 'comment' or length(btrim(coalesce(note, ''))) > 0)
);

create index board_events_card_idx on public.board_events (card_id, created_at);
create index board_events_goal_idx on public.board_events (goal_id, created_at);
create index board_events_recent_idx on public.board_events (created_at desc);

alter table public.goals enable row level security;
alter table public.goal_kpis enable row level security;
alter table public.boards enable row level security;
alter table public.board_columns enable row level security;
alter table public.board_fields enable row level security;
alter table public.board_cards enable row level security;
alter table public.board_events enable row level security;

-- App access is service-role (bypasses RLS) and gated in-route by
-- requirePage / canViewBoard; these policies are the forward-looking
-- convention the other admin tables follow.
create policy "admins can select goals"
  on public.goals for select using (public.is_admin());
create policy "admins can insert goals"
  on public.goals for insert with check (public.is_admin());
create policy "admins can update goals"
  on public.goals for update using (public.is_admin()) with check (public.is_admin());
create policy "admins can delete goals"
  on public.goals for delete using (public.is_admin());

create policy "admins can select goal kpis"
  on public.goal_kpis for select using (public.is_admin());
create policy "admins can insert goal kpis"
  on public.goal_kpis for insert with check (public.is_admin());
create policy "admins can update goal kpis"
  on public.goal_kpis for update using (public.is_admin()) with check (public.is_admin());
create policy "admins can delete goal kpis"
  on public.goal_kpis for delete using (public.is_admin());

create policy "admins can select boards"
  on public.boards for select using (public.is_admin());
create policy "admins can insert boards"
  on public.boards for insert with check (public.is_admin());
create policy "admins can update boards"
  on public.boards for update using (public.is_admin()) with check (public.is_admin());
create policy "admins can delete boards"
  on public.boards for delete using (public.is_admin());

create policy "admins can select board columns"
  on public.board_columns for select using (public.is_admin());
create policy "admins can insert board columns"
  on public.board_columns for insert with check (public.is_admin());
create policy "admins can update board columns"
  on public.board_columns for update using (public.is_admin()) with check (public.is_admin());
create policy "admins can delete board columns"
  on public.board_columns for delete using (public.is_admin());

create policy "admins can select board fields"
  on public.board_fields for select using (public.is_admin());
create policy "admins can insert board fields"
  on public.board_fields for insert with check (public.is_admin());
create policy "admins can update board fields"
  on public.board_fields for update using (public.is_admin()) with check (public.is_admin());
create policy "admins can delete board fields"
  on public.board_fields for delete using (public.is_admin());

create policy "admins can select board cards"
  on public.board_cards for select using (public.is_admin());
create policy "admins can insert board cards"
  on public.board_cards for insert with check (public.is_admin());
create policy "admins can update board cards"
  on public.board_cards for update using (public.is_admin()) with check (public.is_admin());
create policy "admins can delete board cards"
  on public.board_cards for delete using (public.is_admin());

-- Events are written once and read forever: no update, no delete policy, the
-- same shape incident_events takes. An audit line nobody can edit is the
-- whole point of keeping one.
create policy "admins can select board events"
  on public.board_events for select using (public.is_admin());
create policy "admins can insert board events"
  on public.board_events for insert with check (public.is_admin());

-- The two boards the tool opens with.
--
-- `goals` is the founders' task board: three columns, because five was the
-- part of Trello that needed grooming more than it helped. Blocked work stays
-- in progress with a `waiting_on` note on the card.
insert into public.boards (slug, name, description, card_noun, include_in_all_tasks, sort_order)
values (
  'goals',
  'Tasks',
  'Everything the founders owe, filed under the goal it advances.',
  'task',
  true,
  10
);

insert into public.board_columns (board_id, key, label, kind, sort_order)
select b.id, c.key, c.label, c.kind, c.sort_order
from public.boards b
cross join (values
  ('todo', 'To do', 'open', 10),
  ('in_progress', 'In progress', 'open', 20),
  ('done', 'Done', 'done', 30)
) as c (key, label, kind, sort_order)
where b.slug = 'goals';

-- `rentals` is the first lead pipeline and the worked example of everything a
-- board can do that a task list cannot: its own columns, its own fields, its
-- own grant (board:rentals), and an intake endpoint that can turn a form
-- submission on the landing page into a card. It stays out of All Tasks —
-- leads are a queue, not a to-do list.
insert into public.boards (slug, name, description, card_noun, include_in_all_tasks, sort_order)
values (
  'rentals',
  'Rental & group leads',
  'Private rentals and group bookings, from first enquiry to booked.',
  'lead',
  false,
  20
);

insert into public.board_columns (board_id, key, label, kind, sort_order)
select b.id, c.key, c.label, c.kind, c.sort_order
from public.boards b
cross join (values
  ('new', 'New', 'open', 10),
  ('contacted', 'Contacted', 'open', 20),
  ('quoted', 'Quoted', 'open', 30),
  ('booked', 'Booked', 'done', 40),
  ('lost', 'Lost', 'dropped', 50)
) as c (key, label, kind, sort_order)
where b.slug = 'rentals';

insert into public.board_fields (board_id, key, label, kind, options, hint, show_on_card, sort_order)
select b.id, f.key, f.label, f.kind, f.options, f.hint, f.show_on_card, f.sort_order
from public.boards b
cross join (values
  ('contact_name', 'Contact name', 'text', '{}'::text[], null, true, 10),
  ('contact_email', 'Contact email', 'text', '{}'::text[], null, false, 20),
  ('phone', 'Phone', 'text', '{}'::text[], null, false, 30),
  ('requested_date', 'Requested date', 'date', '{}'::text[],
    'The date they are asking about, not the date they wrote in.', true, 40),
  ('party_size', 'Party size', 'number', '{}'::text[], 'How many people.', true, 50),
  ('occasion', 'Occasion', 'text', '{}'::text[],
    'Birthday, team offsite, bachelorette — what the booking is for.', false, 60)
) as f (key, label, kind, options, hint, show_on_card, sort_order)
where b.slug = 'rentals';

comment on table public.goals is
  'A goal is the unit of work: what we are trying to achieve, the KPIs that say whether it was, and the tasks that roll up to it. Optionally nests one level under a parent goal. Completion is always a human decision — nothing closes a goal on task counts.';
comment on table public.goal_kpis is
  'The numbers a goal is judged on: start -> current -> target, with a direction. Hand-measured today (measured_at/measured_by say when and by whom); `source` is reserved for KPIs that will later read a live number.';
comment on table public.boards is
  'A column layout with a name. `goals` is the founders'' task board; other boards are pipelines (rental leads, group bookings) with their own columns, fields, and per-board grants (board:<slug>).';
comment on table public.board_columns is
  'The columns of one board. `kind` says what sitting in a column means: open, done, or dropped. Columns are archived, never deleted.';
comment on table public.board_fields is
  'Per-board questions, keyed by a permanent key that board_cards.properties uses. Modeled on guest_profile_fields; a lead board asks for a contact and a party size, the task board asks for nothing.';
comment on table public.board_cards is
  'One task or lead. Lives in a column, optionally filed under a goal, optionally owned and dated. `waiting_on` keeps blocked work visible without a fourth column; `external_ref` makes intake deliveries idempotent.';
comment on table public.board_events is
  'The audit trail and comment thread for goals and cards: who moved, assigned, measured, completed, or said what. Insert-only, like incident_events.';

-- Goals and boards join the inbox: a task assigned to you, a card you own
-- finishing, a goal you drove being called met, a comment on something you
-- are on, and a lead arriving from the web all belong beside the shift-note
-- replies and schedule changes people already read there. One kind covers
-- them; the notification's own title says which it is.
alter table public.staff_notifications
  drop constraint staff_notifications_kind_check;

alter table public.staff_notifications
  add constraint staff_notifications_kind_check check (
    kind in (
      'admin_message',
      'message_reply',
      'sop_updated',
      'schedule_change',
      'shift_note_reply',
      'sub_request',
      'goal_activity'
    )
  );
