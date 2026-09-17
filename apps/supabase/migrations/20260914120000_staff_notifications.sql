-- Staff notifications and admin messages, for the /admin dashboard.
--
-- Until now the dashboard had no way for the admins to talk to the team
-- inside the tool, and no way for anyone to learn that something they care
-- about changed — an SOP they follow, a shift they are on, a reply on their
-- shift note — short of an email or noticing it on the page. Three tables:
--
--   1. admin_messages — a message an admin writes in markdown to an audience
--      (a set of roles plus individually named staff, the same shape as SOP
--      access grants). Everyone who can see a message may reply, so each
--      message is one thread (admin_message_replies). Messages persist; an
--      admin can pin one to the top or archive it.
--   2. admin_message_replies — the thread under a message. Attributed to the
--      session email like every other authored row; editing and deleting a
--      reply is its author or an admin.
--   3. staff_notifications — one person's inbox. Fan-out on write: every
--      event that should reach someone inserts one row per recipient (the
--      roster is a dozen people, so this stays cheap). Rows are written by
--      the API routes that already record the event (the schedule change
--      log, an SOP version, a reply) — no triggers, no realtime. A row is
--      unread until the person opens it, and gone from the inbox once
--      dismissed; the timely kinds (a shift change, an SOP edit) also carry
--      an expiry so they fall away on their own. source_type/source_id name
--      what produced the row, so a newer event about the same thing can
--      replace the stale unread row instead of piling up, and opening a
--      message thread can mark its notifications read.
--
-- Access is enforced in the app (lib/messages/access, lib/notifications);
-- app access is service-role (bypasses RLS), so the policies below are the
-- admin-only forward-looking convention the other admin tables follow.

create table public.admin_messages (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) > 0 and char_length(title) <= 200),
  -- Markdown, rendered with the same renderer as the SOP library.
  body_md text not null check (length(btrim(body_md)) > 0 and char_length(body_md) <= 20000),
  -- Email from the session, never the request body.
  author_email text not null check (char_length(author_email) between 3 and 320),
  -- Who sees it: the union of these roles (staff / shift leads / admins —
  -- a set, not a floor, exactly as sops.view_roles) and these named people.
  -- Admins always see every message whatever the grant says.
  audience_roles text[] not null default array['staff', 'shift_lead', 'admin']
    check (audience_roles <@ array['staff', 'shift_lead', 'admin']::text[]),
  audience_emails text[] not null default '{}'
    check (coalesce(array_length(audience_emails, 1), 0) <= 100),
  -- Pinned messages sort first on /admin/messages.
  pinned boolean not null default false,
  -- Set when an admin archives the message: hidden from staff, read-only.
  archived_at timestamptz,
  -- Session email of the last admin to edit it; null until edited.
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The page lists pinned messages first, then newest first.
create index admin_messages_list_idx on public.admin_messages (pinned desc, created_at desc);

create trigger admin_messages_set_updated_at
  before update on public.admin_messages
  for each row execute function public.set_updated_at();

alter table public.admin_messages enable row level security;

create policy "admins can select admin messages"
  on public.admin_messages for select
  using (public.is_admin());

create policy "admins can insert admin messages"
  on public.admin_messages for insert
  with check (public.is_admin());

create policy "admins can update admin messages"
  on public.admin_messages for update
  using (public.is_admin());

create policy "admins can delete admin messages"
  on public.admin_messages for delete
  using (public.is_admin());

comment on table public.admin_messages is
  'Admin-authored markdown messages to staff (/admin/messages): one thread each, addressed to a set of roles plus named people, attributed to the session email.';

create table public.admin_message_replies (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.admin_messages (id) on delete cascade,
  -- Markdown, like the message it answers.
  body_md text not null check (length(btrim(body_md)) > 0 and char_length(body_md) <= 4000),
  -- Email from the session, never the request body.
  author_email text not null check (char_length(author_email) between 3 and 320),
  -- Session email of the last editor (reply author or admin); null until edited.
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A thread reads in writing order.
create index admin_message_replies_thread_idx
  on public.admin_message_replies (message_id, created_at);

create trigger admin_message_replies_set_updated_at
  before update on public.admin_message_replies
  for each row execute function public.set_updated_at();

alter table public.admin_message_replies enable row level security;

create policy "admins can select admin message replies"
  on public.admin_message_replies for select
  using (public.is_admin());

create policy "admins can insert admin message replies"
  on public.admin_message_replies for insert
  with check (public.is_admin());

create policy "admins can update admin message replies"
  on public.admin_message_replies for update
  using (public.is_admin());

create policy "admins can delete admin message replies"
  on public.admin_message_replies for delete
  using (public.is_admin());

comment on table public.admin_message_replies is
  'Reply thread under an admin message (/admin/messages/<id>): anyone who can see the message may reply; author-or-admin may edit or delete a reply.';

create table public.staff_notifications (
  id uuid primary key default gen_random_uuid(),
  -- Whose inbox this row sits in (staff email, lowercased).
  recipient_email text not null check (char_length(recipient_email) between 3 and 320),
  kind text not null check (
    kind in (
      'admin_message',
      'message_reply',
      'sop_updated',
      'schedule_change',
      'shift_note_reply',
      'sub_request'
    )
  ),
  title text not null check (length(btrim(title)) > 0 and char_length(title) <= 200),
  -- Short plain-text detail under the title (an excerpt, a time window).
  body text not null default '' check (char_length(body) <= 1000),
  -- Where the row opens. Null for a recipient who can't open the page the
  -- event lives on (a roster-only person without the schedule grant); the
  -- inbox then shows the row without a link.
  href text check (href like '/admin%' and char_length(href) <= 500),
  -- What produced the row: 'admin_message' + message id, 'sop' + id,
  -- 'shift' + id, 'proposal' + id, 'shift_note' + id, 'sub_request' + id.
  source_type text not null check (char_length(source_type) <= 40),
  source_id text not null check (char_length(source_id) <= 80),
  -- Who caused it (session email), null for the Momence sync. Never a
  -- recipient of their own event.
  actor_email text,
  -- Opened (or explicitly marked read).
  read_at timestamptz,
  -- Cleared from the inbox; implies read.
  dismissed_at timestamptz,
  -- Timely kinds fall away on their own after this; null keeps the row
  -- until dismissed.
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- The inbox: one person's rows, newest first.
create index staff_notifications_inbox_idx
  on public.staff_notifications (recipient_email, created_at desc);

-- The badge count: unread rows only, so it stays tiny however long the
-- history grows.
create index staff_notifications_unread_idx
  on public.staff_notifications (recipient_email)
  where read_at is null and dismissed_at is null;

-- Superseding a stale row and auto-reading a thread both look rows up by
-- what produced them.
create index staff_notifications_source_idx
  on public.staff_notifications (source_type, source_id);

alter table public.staff_notifications enable row level security;

create policy "admins can select staff notifications"
  on public.staff_notifications for select
  using (public.is_admin());

create policy "admins can insert staff notifications"
  on public.staff_notifications for insert
  with check (public.is_admin());

create policy "admins can update staff notifications"
  on public.staff_notifications for update
  using (public.is_admin());

create policy "admins can delete staff notifications"
  on public.staff_notifications for delete
  using (public.is_admin());

comment on table public.staff_notifications is
  'Per-person inbox for the /admin dashboard (bell + /admin/notifications): one row per recipient per event, written by the API routes; read_at / dismissed_at / expires_at drive the badge and the list.';
