-- Customer referral program (apps/integrations). Every referrer — an
-- individual Momence member or a partner business — gets a personalized code
-- (e.g. WES15) behind pyresauna.com/r/{code}. A friend who opens the link and
-- submits their email is find-or-created in Momence and given the tier's
-- customer tag; the manually-created tag-keyed Price Rule applies the discount
-- at checkout, exactly like the partner program. Momence discount codes have
-- no API (dashboard-only, not person-restrictable), which is why the code is
-- Pyre-side and the discount vehicle is a tag.
--
-- Hard rule: first-time customers only. Redemption is rejected for anyone with
-- booking history, and the first-booking check is re-verified at conversion
-- time before any reward is granted.
--
-- Four tables:
--   referral_tiers       percent -> Momence tag the Price Rule keys on
--   referrers            one row + one code per referrer (member XOR partner)
--   referral_redemptions the friend-side state machine (audit trail, no deletes)
--   referral_rewards     the referrer-side reward ledger (double-sided program)

-- Tier registry. Each row needs a matching Momence customer tag AND a Price
-- Rule keyed on that tag, both created by hand in the Momence dashboard
-- before the tier is usable (same operational contract as partners.tag_name).
create table public.referral_tiers (
  percent integer primary key check (percent > 0 and percent < 100),
  -- Momence customer tag (matched case-insensitively) the Price Rule keys on
  tag_name text not null unique check (btrim(tag_name) <> ''),
  -- Off = no new referrers may be assigned this tier; existing referrers keep it
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.referral_tiers (percent, tag_name) values (15, 'referral-15');

alter table public.referral_tiers enable row level security;

create policy "admins can select referral_tiers"
  on public.referral_tiers for select
  to authenticated
  using (public.is_admin());

-- One row per referrer; the personalized code lives here (one code per
-- referrer in v1).
create table public.referrers (
  id uuid primary key default gen_random_uuid(),
  referrer_type text not null check (referrer_type in ('member', 'partner')),
  -- Member referrers: their Momence member id. Partner referrers: the
  -- partners.slug — deliberately NOT a foreign key, matching the
  -- partner_verifications convention (history outlives partner rows).
  momence_member_id bigint unique,
  partner_slug text unique,
  check (
    (referrer_type = 'member' and momence_member_id is not null and partner_slug is null)
    or (referrer_type = 'partner' and partner_slug is not null and momence_member_id is null)
  ),
  -- Member referrers: their email, used for the self-referral check and the
  -- reward email. Null for partners (their contacts live on the partners row).
  email text check (email is null or email = lower(email)),
  -- What the friend sees on the landing page: "Wes gave you 15% off" /
  -- "BFT Carytown gave you 15% off"
  display_name text not null check (btrim(display_name) <> ''),
  -- The shareable code, uppercase, unique across all referrers. Generated as
  -- FIRSTNAME + 2 digits for members; chosen by admins for partners.
  code text not null unique
    check (code = upper(code) and code ~ '^[A-Z0-9]{3,16}$'),
  -- Which tier this referrer's friends get. FK so a tier can't be deleted out
  -- from under its referrers.
  discount_percent integer not null default 15
    references public.referral_tiers (percent),
  -- Off = the /r/{code} page 404s and redemption attempts are rejected.
  -- Existing redemptions are unaffected.
  enabled boolean not null default true,
  notes text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.referrers enable row level security;

create policy "admins can select referrers"
  on public.referrers for select
  to authenticated
  using (public.is_admin());

create trigger referrers_set_updated_at
  before update on public.referrers
  for each row execute function public.set_updated_at();

-- The friend-side state machine. Code/percent/tag are snapshotted at
-- redemption time so history stays true when a referrer's tier changes later.
--
--   pending    row claimed, Momence member/tag write not yet confirmed
--   redeemed   tag on the member, discount live, awaiting first booking
--   converted  first booking completed (terminal happy path)
--   expired    never booked within the window; tag removed by the sweep
--   revoked    pulled by an admin, or by the conversion path when the
--              first-booking re-check failed (revoke_reason = 'not-first-time')
create table public.referral_redemptions (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.referrers (id),
  code text not null,
  discount_percent integer not null,
  tag_name text not null,
  friend_first_name text not null check (btrim(friend_first_name) <> ''),
  friend_last_name text not null check (btrim(friend_last_name) <> ''),
  friend_email text not null check (friend_email = lower(friend_email)),
  friend_momence_member_id bigint,
  status text not null default 'pending'
    check (status in ('pending', 'redeemed', 'converted', 'expired', 'revoked')),
  -- When the tier tag actually came off the member in Momence. Null on a live
  -- discount; also null when removal failed and needs the maintenance sweep.
  discount_tag_removed_at timestamptz,
  converted_session_id bigint,
  converted_session_booking_id bigint,
  converted_at timestamptz,
  -- The converting booking was later cancelled. Surfaced in the admin queue
  -- for a manual decision — no automatic clawback.
  cancelled_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  -- Who moved the row: null = system (webhook/redemption path), an email = an
  -- admin, 'cron' = the maintenance sweep. Same convention as
  -- partner_verifications.decided_by.
  decided_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One referral discount per friend, ever, across all referrers. Doubles as
-- the concurrency guard on simultaneous submissions (insert races surface as
-- 23505). Expired/revoked rows drop out so a friend whose discount lapsed
-- unused could be re-referred by an admin decision.
create unique index referral_redemptions_live_friend_idx
  on public.referral_redemptions (friend_email)
  where status in ('pending', 'redeemed', 'converted');

-- The admin queue and the referrer's /account stats: newest first per referrer.
create index referral_redemptions_referrer_idx
  on public.referral_redemptions (referrer_id, created_at desc);

-- The session-booked webhook lookup: is this member an awaiting-first-booking
-- friend?
create index referral_redemptions_active_member_idx
  on public.referral_redemptions (friend_momence_member_id)
  where status = 'redeemed';

alter table public.referral_redemptions enable row level security;

create policy "admins can select referral_redemptions"
  on public.referral_redemptions for select
  to authenticated
  using (public.is_admin());

create trigger referral_redemptions_set_updated_at
  before update on public.referral_redemptions
  for each row execute function public.set_updated_at();

-- The referrer-side reward ledger (member referrers only in v1 — partner
-- conversions are settled manually off the redemption counts).
--
--   granted   reward tag on the referrer, discount live for their next session
--   consumed  their next booking arrived; tag removed
--   expired   unused past the reward window; tag removed by the sweep
--   revoked   pulled by an admin (e.g. the converting booking was cancelled)
create table public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.referrers (id),
  -- One reward per conversion, enforced here — this is the idempotency guard
  -- against webhook retries racing the reward grant.
  redemption_id uuid not null unique references public.referral_redemptions (id),
  reward_tag_name text not null,
  status text not null default 'granted'
    check (status in ('granted', 'consumed', 'expired', 'revoked')),
  granted_at timestamptz not null default now(),
  consumed_at timestamptz,
  consumed_session_booking_id bigint,
  reward_tag_removed_at timestamptz,
  decided_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index referral_rewards_referrer_idx
  on public.referral_rewards (referrer_id, granted_at desc);

alter table public.referral_rewards enable row level security;

create policy "admins can select referral_rewards"
  on public.referral_rewards for select
  to authenticated
  using (public.is_admin());

create trigger referral_rewards_set_updated_at
  before update on public.referral_rewards
  for each row execute function public.set_updated_at();
