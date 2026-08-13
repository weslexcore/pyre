-- Amount-agnostic referral tags. Tag names had the discount baked in
-- ('referral-15'), which meant changing the offer meant renaming tags and
-- price rules everywhere. The tags become just 'referral' (friend side) and
-- 'referral-reward' (referrer side, already generic); the amounts live only
-- in the Momence price rules and in the display label added here — so
-- retuning the program ("$5 off" -> "$10 off") is a dashboard edit plus a
-- label update, no code and no re-tagging.

alter table public.referral_tiers
  add column label text;

-- Backfill: legacy tiers were percent-shaped.
update public.referral_tiers set label = percent || '% off' where label is null;

alter table public.referral_tiers
  alter column label set not null;

-- The launch tier: give $5 (tag 'referral' + a $5 absolute price rule).
update public.referral_tiers
set tag_name = 'referral', label = '$5'
where percent = 15 and tag_name = 'referral-15';
