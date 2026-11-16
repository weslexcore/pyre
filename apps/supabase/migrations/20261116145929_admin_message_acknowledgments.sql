-- Read-and-acknowledge for admin messages (/admin/messages): an admin can
-- ask the audience to confirm they've read a message, and see who has and
-- who hasn't.
--
--   admin_messages.requires_ack          — the composer's "require
--                                          acknowledgment" switch. Can be
--                                          turned on or off after sending;
--                                          turning it off hides the button
--                                          and the tally but keeps the acks.
--   admin_message_templates.requires_ack — a template carries the switch
--                                          into the message it starts.
--   admin_message_acks                   — one row per person per message:
--                                          who acknowledged it and when.
--                                          Acknowledging is one-way — staff
--                                          can't take it back — so the record
--                                          holds people to what they read.
--
-- Access is enforced in the app (lib/messages/access); app access is
-- service-role, so the admin-only policies below follow the convention of
-- the other admin message tables (20260914120000_staff_notifications.sql).

alter table public.admin_messages
  add column requires_ack boolean not null default false;

comment on column public.admin_messages.requires_ack is
  'Whether the audience is asked to acknowledge they have read the message (admin_message_acks).';

alter table public.admin_message_templates
  add column requires_ack boolean not null default false;

comment on column public.admin_message_templates.requires_ack is
  'Whether a message started from this template asks for acknowledgment.';

create table public.admin_message_acks (
  message_id uuid not null references public.admin_messages (id) on delete cascade,
  -- Session email of the person acknowledging (lowercased), never the request body.
  email text not null check (char_length(email) between 3 and 320),
  acknowledged_at timestamptz not null default now(),
  primary key (message_id, email)
);

alter table public.admin_message_acks enable row level security;

create policy "admins can select admin message acks"
  on public.admin_message_acks for select
  using (public.is_admin());

create policy "admins can insert admin message acks"
  on public.admin_message_acks for insert
  with check (public.is_admin());

create policy "admins can update admin message acks"
  on public.admin_message_acks for update
  using (public.is_admin());

create policy "admins can delete admin message acks"
  on public.admin_message_acks for delete
  using (public.is_admin());

comment on table public.admin_message_acks is
  'Who has acknowledged reading an admin message that requires it, and when. One row per person per message; written by /api/admin/message-acks.';
