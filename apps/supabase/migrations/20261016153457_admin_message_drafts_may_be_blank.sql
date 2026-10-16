-- Admin message drafts may be incomplete. The composer now autosaves a new
-- message as a private draft as soon as there is anything in it, so someone
-- who leaves the page comes back to it under Drafts — and what they have
-- typed by then may be a body with no title yet, or a title alone.
--
-- The title and body checks from 20260914120000_staff_notifications.sql
-- required both to be non-blank on every row. They now apply only once the
-- message is sent (sent_at set, see 20261016141606_admin_message_drafts.sql);
-- the length limits hold for drafts too. The app enforces the same rule
-- before it sends (lib/messages/validate).

alter table public.admin_messages
  drop constraint admin_messages_title_check,
  drop constraint admin_messages_body_md_check;

alter table public.admin_messages
  add constraint admin_messages_title_check check (
    char_length(title) <= 200 and (sent_at is null or length(btrim(title)) > 0)
  ),
  add constraint admin_messages_body_md_check check (
    char_length(body_md) <= 20000 and (sent_at is null or length(btrim(body_md)) > 0)
  );
