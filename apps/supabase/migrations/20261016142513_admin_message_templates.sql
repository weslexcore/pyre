-- Message templates (/admin/messages/templates): a reusable starting point
-- for an admin message — a weekly update, a closing notice — that admins
-- set up once and fill in each time. Starting a message from a template
-- copies its title, body, audience, and pin into the composer; nothing links
-- the message back, so editing or deleting a template never touches a
-- message already written from it.
--
-- The title and body may hold date placeholders ({{date}}, {{week_of}}),
-- filled in when the template is used (lib/messages/templates). Templates are
-- shared: any admin may create, edit, or delete any of them.
--
-- Access is enforced in the app (/api/admin/message-templates, admins only);
-- app access is service-role (bypasses RLS), so the policies below are the
-- admin-only convention the other admin tables follow.

create table public.admin_message_templates (
  id uuid primary key default gen_random_uuid(),
  -- What the template is called in the picker ("Weekly update").
  name text not null check (length(btrim(name)) > 0 and char_length(name) <= 100),
  -- The message title and markdown body it starts from; same limits as
  -- admin_messages, so a filled-in template always fits a message.
  title text not null check (length(btrim(title)) > 0 and char_length(title) <= 200),
  body_md text not null check (length(btrim(body_md)) > 0 and char_length(body_md) <= 20000),
  -- The audience and pin a message from it starts with, shaped exactly like
  -- admin_messages.audience_roles / audience_emails.
  audience_roles text[] not null default array['staff', 'shift_lead', 'admin']
    check (audience_roles <@ array['staff', 'shift_lead', 'admin']::text[]),
  audience_emails text[] not null default '{}'
    check (coalesce(array_length(audience_emails, 1), 0) <= 100),
  pinned boolean not null default false,
  -- Session emails of who made it and who last changed it (null until edited).
  created_by text not null check (char_length(created_by) between 3 and 320),
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The picker lists templates by name; two with the same name would be
-- indistinguishable there.
create unique index admin_message_templates_name_key
  on public.admin_message_templates (lower(name));

create trigger admin_message_templates_set_updated_at
  before update on public.admin_message_templates
  for each row execute function public.set_updated_at();

alter table public.admin_message_templates enable row level security;

create policy "admins can select admin message templates"
  on public.admin_message_templates for select
  using (public.is_admin());

create policy "admins can insert admin message templates"
  on public.admin_message_templates for insert
  with check (public.is_admin());

create policy "admins can update admin message templates"
  on public.admin_message_templates for update
  using (public.is_admin());

create policy "admins can delete admin message templates"
  on public.admin_message_templates for delete
  using (public.is_admin());

-- New tables don't inherit the service-role grants the app relies on.
grant select, insert, update, delete on public.admin_message_templates to service_role;

comment on table public.admin_message_templates is
  'Reusable starting points for admin messages (/admin/messages/templates): name, title, body with date placeholders, default audience and pin. Shared by all admins.';
