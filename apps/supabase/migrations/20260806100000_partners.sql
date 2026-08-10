-- Partner registry for the reciprocal-discount program (apps/integrations).
-- Moves what was the hardcoded PARTNERS map in src/lib/partner/config.ts into
-- rows managed from /admin/partners, so adding a partner, retuning its
-- discount, or changing who verifies membership is a dashboard edit instead of
-- a deploy. Momence still owns the discount itself (the customer tag and the
-- tag-keyed price rule) and the landing page still hardcodes its own copy —
-- this table is the integrations-side source of truth for who to email, which
-- tag to assign, and how the partner emails read.
--
-- Also extends partner_verifications with the 'revoked' status and the audit
-- columns the admin request queue needs: who decided, and how many partner
-- contacts the request email actually reached.

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  -- Stable key used in URLs, PostHog event properties, the landing page's
  -- relay payload, and partner_verifications.partner_slug. Deliberately NOT a
  -- foreign-key target: verification history has to outlive a partner row.
  -- Treated as immutable by the API — see /api/admin/partners PATCH.
  slug text not null unique
    check (slug = lower(slug) and slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  -- Display name used in email copy ("BFT Carytown")
  name text not null check (btrim(name) <> ''),
  -- Momence customer tag (matched case-insensitively) the price rule keys on.
  -- Renaming this does NOT re-tag members who were already tagged.
  tag_name text not null check (btrim(tag_name) <> ''),
  discount_percent integer not null default 15
    check (discount_percent > 0 and discount_percent < 100),
  -- Everyone who receives the confirm/deny email. Every copy carries the same
  -- signed links and the first click wins. Empty = partner not yet configured;
  -- verification requests are rejected. Lowercase is enforced over the joined
  -- string because a subquery isn't allowed in a check constraint.
  contact_emails text[] not null default '{}'
    check (
      array_to_string(contact_emails, ',') = lower(array_to_string(contact_emails, ','))
      and coalesce(array_length(contact_emails, 1), 0) <= 10
    ),
  -- Per-partner override of the global PARTNER_CC_EMAIL env var; null = use env
  cc_email text check (cc_email is null or cc_email = lower(cc_email)),
  -- Off = reject new verification requests and skip reconciliation. Confirm/
  -- deny links already sitting in an inbox keep working (see applyDecision).
  enabled boolean not null default true,
  -- How long confirm/deny links and their pending rows live. Per-partner
  -- because partners answer at different speeds. The token expiry is baked in
  -- at send time, so changing this never retroactively expires or extends
  -- links that already went out.
  decision_expiry_days integer not null default 14
    check (decision_expiry_days between 1 and 90),
  -- Off = skip this partner in the quarterly reconciliation email
  reconciliation_enabled boolean not null default true,
  notes text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- No secondary index: this table holds single-digit rows and is read through a
-- 30s in-process cache (src/lib/partner/registry.ts). The unique slug is enough.

alter table public.partners enable row level security;

-- App access is service-role (bypasses RLS); this policy is forward-looking
-- convention, same as the other tables.
create policy "admins can select partners"
  on public.partners for select
  to authenticated
  using (public.is_admin());

create trigger partners_set_updated_at
  before update on public.partners
  for each row execute function public.set_updated_at();

-- Seed the one live partner. contact_emails is left empty on purpose: the
-- address belongs to a third party and migrations live in git. Until an admin
-- enters it on /admin/partners the runtime falls back to the legacy
-- PARTNER_BFT_CONTACT_EMAIL env var, the same env-bootstrap shape the staff
-- table uses for ADMIN_EMAILS.
insert into public.partners (slug, name, tag_name, discount_percent)
values ('bft', 'BFT Carytown', 'partner-bft', 15)
on conflict (slug) do nothing;

-- 'revoked': an admin pulled the Momence tag back off the member (partner
-- offboarded, membership lapsed, mistaken confirm). Kept distinct from
-- 'denied' (the partner said no up front) so the audit trail stays honest.
-- Revoked rows don't participate in the pending partial-unique index, so the
-- customer can submit a fresh request.
-- The original constraint was declared inline on the column, so its name was
-- auto-generated. Look it up rather than hardcoding the expected name, and
-- fail loudly if it isn't there — dropping nothing and then adding the widened
-- constraint would silently leave the old one in force, still rejecting
-- 'revoked'.
do $$
declare
  con_name text;
  found_any boolean := false;
begin
  for con_name in
    select conname
    from pg_constraint
    where conrelid = 'public.partner_verifications'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%'
  loop
    execute format('alter table public.partner_verifications drop constraint %I', con_name);
    found_any := true;
  end loop;

  if not found_any then
    raise exception 'No status check constraint found on partner_verifications';
  end if;
end $$;

alter table public.partner_verifications
  add constraint partner_verifications_status_check
    check (status in ('pending', 'confirmed', 'denied', 'expired', 'revoked'));

alter table public.partner_verifications
  add column revoked_at timestamptz,
  add column revoke_reason text,
  -- Who acted: null = the partner's one-click email link (the original path),
  -- an email = an admin acting from /admin/partners, 'cron' = the expiry sweep
  add column decided_by text,
  -- How many partner contacts the request email actually reached. 0 means
  -- nobody was emailed — usually the EMAIL_LIVE_TEMPLATES gate — which the
  -- admin queue badges so the failure isn't silent.
  add column notified_count integer not null default 0,
  add column last_notified_at timestamptz;

-- The admin request queue: filter by partner, newest first. The existing
-- (status, created_at) index still serves the expiry sweep.
create index partner_verifications_partner_idx
  on public.partner_verifications (partner_slug, created_at desc);
