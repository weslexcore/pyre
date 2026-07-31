-- Partner-membership verification requests for the reciprocal discount program
-- (apps/integrations). A customer claims membership at a partner business (e.g.
-- BFT Carytown) on the landing page; the partner's contact confirms or denies
-- via signed one-click email links; on confirm the customer is tagged in
-- Momence, where a tag-keyed price rule applies the discount at checkout.
--
-- Momence stays the source of truth for the tag itself (reconciliation reads
-- tagged members live) — this table holds only the audit/workflow state:
-- who asked, who decided, and when.

create table public.partner_verifications (
  id uuid primary key default gen_random_uuid(),
  -- key into the PARTNERS config in apps/integrations (e.g. 'bft')
  partner_slug text not null,
  -- split to mirror Momence's member profile fields
  customer_first_name text not null,
  customer_last_name text not null,
  -- the email the customer books with at Pyre (the one that gets tagged)
  customer_email text not null check (customer_email = lower(customer_email)),
  -- the email on their partner membership, when different
  partner_member_email text check (partner_member_email = lower(partner_member_email)),
  -- collected to complete the member's Momence profile on confirm
  customer_phone text,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'denied', 'expired')),
  -- set on confirm: the Momence member the partner tag was assigned to
  momence_member_id bigint,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One open request per (partner, customer); dedupe backstop for webhook-style
-- retries — the request endpoint also checks before inserting.
create unique index partner_verifications_pending_idx
  on public.partner_verifications (partner_slug, customer_email)
  where status = 'pending';

-- The expiry sweep: pending rows older than the cutoff.
create index partner_verifications_status_idx
  on public.partner_verifications (status, created_at);

alter table public.partner_verifications enable row level security;

create policy "admins can select partner verifications"
  on public.partner_verifications for select
  to authenticated
  using (public.is_admin());

create trigger partner_verifications_set_updated_at
  before update on public.partner_verifications
  for each row execute function public.set_updated_at();
