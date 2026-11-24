-- Member perks: the reverse of the reciprocal-discount program. Until now the
-- partner flow ran one way: a partner's member claims a Pyre discount and the
-- partner confirms them (partner_verifications). This adds the other way: a
-- Pyre member who wants their perk at a partner asks Pyre to vouch for them,
-- and Pyre emails the partner that the membership is valid.
--
-- Flow (apps/integrations src/lib/partner/member-verification.ts):
--   1. the member submits their booking email on the landing page /perks
--   2. we email THEM a signed confirm link. This proves they own the address,
--      and it gets their consent before their name goes to a third party.
--   3. on click, Momence is checked live for an active membership. If there is
--      one, the partner's contacts are emailed that the membership is valid.
--      If not, nothing goes to the partner and the member is told why.
--
-- Momence stays the source of truth for membership; this table is the audit
-- trail of who asked, what we told which partner, and when.

-- What the partner gives Pyre members, in the words the partner email and the
-- admin page use ("15% off class packs"). null = this partner has no member
-- perk, and requests to verify for it are rejected.
alter table public.partners
  add column member_perk text check (member_perk is null or btrim(member_perk) <> '');

create table public.partner_member_verifications (
  id uuid primary key default gen_random_uuid(),
  -- partners.slug; deliberately not a foreign key, so history outlives a
  -- partner row (same rule as partner_verifications.partner_slug)
  partner_slug text not null,
  -- the email the member books with at Pyre, the one looked up in Momence
  member_email text not null check (member_email = lower(member_email)),
  -- awaiting_confirmation: we emailed the member and wait for their click
  -- verified: they have an active membership and the partner was emailed
  -- not_member: they clicked but Momence shows no active membership
  -- expired: they never clicked; closed when they submit again after the
  -- link died, so the new request can open
  status text not null default 'awaiting_confirmation'
    check (status in ('awaiting_confirmation', 'verified', 'not_member', 'expired')),
  -- set when the member clicks: what Momence said at that moment. The name
  -- comes from Momence, never from the form, because it goes to the partner.
  momence_member_id bigint,
  member_name text,
  membership_name text,
  -- the membership's end date in Momence, if it has one
  membership_ends_at timestamptz,
  -- partner contacts the "membership is valid" email actually reached
  notified_count integer not null default 0,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One open request per (partner, member): a repeat submission inside the link
-- lifetime re-sends nothing. The intake also checks before inserting.
create unique index partner_member_verifications_open_idx
  on public.partner_member_verifications (partner_slug, member_email)
  where status = 'awaiting_confirmation';

-- The admin view: per partner, newest first.
create index partner_member_verifications_partner_idx
  on public.partner_member_verifications (partner_slug, created_at desc);

alter table public.partner_member_verifications enable row level security;

-- App access is service-role (bypasses RLS); admins may read the audit trail.
create policy "admins can select partner member verifications"
  on public.partner_member_verifications for select
  to authenticated
  using (public.is_admin());

create trigger partner_member_verifications_set_updated_at
  before update on public.partner_member_verifications
  for each row execute function public.set_updated_at();

grant all on table public.partner_member_verifications to service_role;
