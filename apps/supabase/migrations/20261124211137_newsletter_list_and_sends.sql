-- The monthly newsletter moves off Mailchimp and is sent by apps/integrations
-- one email per person through Resend's sending API, not as a Resend
-- broadcast. Resend bills its marketing product by stored contacts, so the
-- mailing list lives here instead of in Resend.
--
--   newsletter_subscribers  who is on which list, and how they joined
--   newsletters             each issue: its content, and how far its send got
--
-- Consent and opt-outs stay separate: email_suppressions is still the one
-- record of who must not get marketing email. Unsubscribing never deletes a
-- subscriber row; the send skips anyone suppressed. Each delivered copy is a
-- row in email_sends (template 'newsletter', send_key newsletter:{id}:{email}),
-- which is what stops a resumed send from mailing anyone twice.

-- --- newsletter_subscribers ---

create table public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and btrim(email) <> ''),
  -- filled from Momence or Mailchimp when known; the sign-up forms ask for none
  first_name text,
  last_name text,
  -- every list is a subset of these; 'volunteer' people also get the newsletter
  lists text[] not null default '{newsletter}'
    check (cardinality(lists) > 0 and lists <@ array['newsletter', 'volunteer']::text[]),
  -- where they first joined: website_form, promo_popup, momence, mailchimp-import…
  source text not null check (source ~ '^[a-z0-9_-]{1,60}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.newsletter_subscribers enable row level security;

-- App access is service-role (bypasses RLS); admins may read the list.
create policy "admins can select newsletter subscribers"
  on public.newsletter_subscribers for select
  to authenticated
  using (public.is_admin());

create trigger newsletter_subscribers_set_updated_at
  before update on public.newsletter_subscribers
  for each row execute function public.set_updated_at();

grant all on table public.newsletter_subscribers to service_role;

-- Join one or more lists. A repeat sign-up adds lists and never removes one;
-- a name is only written when one is given, so a nameless form sign-up can't
-- blank the name Momence supplied. The first source is kept.
create function public.newsletter_subscribe(
  p_email text,
  p_lists text[],
  p_source text,
  p_first_name text default null,
  p_last_name text default null
) returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.newsletter_subscribers as s (email, lists, source, first_name, last_name)
  values (
    lower(btrim(p_email)),
    p_lists,
    p_source,
    nullif(btrim(p_first_name), ''),
    nullif(btrim(p_last_name), '')
  )
  on conflict (email) do update set
    lists = array(select distinct unnest(s.lists || excluded.lists) order by 1),
    first_name = coalesce(excluded.first_name, s.first_name),
    last_name = coalesce(excluded.last_name, s.last_name);
$$;

revoke execute on function public.newsletter_subscribe(text, text[], text, text, text)
  from public, anon, authenticated;
grant execute on function public.newsletter_subscribe(text, text[], text, text, text)
  to service_role;

-- --- newsletters ---

create table public.newsletters (
  id uuid primary key default gen_random_uuid(),
  -- the Campaigns-tool slug, e.g. newsletter-2026-12: utm_campaign on every
  -- link and the campaign tag on every send. Resend tags allow [a-z0-9_-].
  campaign text not null check (campaign ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  -- who it goes to: everyone whose lists include this one
  list text not null default 'newsletter' check (list in ('newsletter', 'volunteer')),
  -- the email, in the journey block format (lib/email/journeys/schema.ts):
  -- subject, preview, background and blocks
  content jsonb not null,
  -- draft: being written
  -- sending: approved; the hourly cron job sends it in batches until done
  --   (not before send_after, when that is set)
  -- sent: everyone on the list was reached or skipped
  -- cancelled: stopped by an admin; anyone already sent to stays sent
  status text not null default 'draft'
    check (status in ('draft', 'sending', 'sent', 'cancelled')),
  send_after timestamptz,
  -- the send walks subscribers in email order; this is the last one handled
  cursor_email text,
  sent_count integer not null default 0,
  -- on the suppression list at send time
  suppressed_count integer not null default 0,
  -- Resend refused the address
  failed_count integer not null default 0,
  -- why the last run stopped early, if it did (the next run retries)
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The cron job's lookup: what is approved and due.
create index newsletters_sending_idx
  on public.newsletters (created_at)
  where status = 'sending';

alter table public.newsletters enable row level security;

-- App access is service-role (bypasses RLS); admins may read every issue.
create policy "admins can select newsletters"
  on public.newsletters for select
  to authenticated
  using (public.is_admin());

create trigger newsletters_set_updated_at
  before update on public.newsletters
  for each row execute function public.set_updated_at();

grant all on table public.newsletters to service_role;
