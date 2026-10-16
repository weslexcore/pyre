-- Drafts for admin messages (/admin/messages): an admin can save a message
-- without sending it, keep it to themselves, or share it with other admins
-- so they can work on it together before it goes out.
--
--   sent_at     — when the message went out to its audience. Null means it is
--                 still a draft: nobody in the audience sees it, nobody has
--                 been notified or emailed, and its thread is closed. The
--                 default is now() so an insert that doesn't mention it (every
--                 send) is a sent message; saving a draft passes null.
--   shared_with — admins, besides the author, who can open and edit the
--                 draft. Empty means a private draft only its author sees —
--                 other admins included, unlike a sent message. Ignored once
--                 the message is sent.
--
-- Access is enforced in the app (lib/messages/access); the admin-only RLS
-- policies from 20260914120000_staff_notifications.sql still cover the table.

alter table public.admin_messages
  add column sent_at timestamptz default now(),
  add column shared_with text[] not null default '{}'
    check (coalesce(array_length(shared_with, 1), 0) <= 100);

-- Everything written before drafts existed went out when it was written.
update public.admin_messages set sent_at = created_at;

comment on column public.admin_messages.sent_at is
  'When the message went out to its audience; null while it is a draft.';
comment on column public.admin_messages.shared_with is
  'Admins (lowercased emails) besides the author who may open and edit the draft; empty = private draft.';

-- The list orders sent messages by when they went out, pinned first.
drop index if exists public.admin_messages_list_idx;
create index admin_messages_list_idx
  on public.admin_messages (pinned desc, sent_at desc nulls first);
