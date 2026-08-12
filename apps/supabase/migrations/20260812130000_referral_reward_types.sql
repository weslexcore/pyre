-- Reward types for the referral program (apps/integrations). The original
-- reward had one shape: a Momence tag whose price rule discounts the
-- referrer's next session. That reward is worthless to exactly the best
-- referrers -- members -- (credit-pack and subscription holders don't pay
-- cash per session), so grants now branch on what the referrer actually buys:
--
--   credit    +1 event credit on their active package-events pack, via
--             PUT /host/members/{id}/bought-memberships/{bmId}/credits.
--             Delivered instantly, so rows land already 'consumed'.
--   manual    subscription holders with no pack (e.g. unlimited members):
--             a staff-fulfilled comp, 'granted' until marked consumed from
--             /admin/referrals.
--   discount  the original tag + price rule, for drop-in payers.

alter table public.referral_rewards
  add column reward_type text not null default 'discount'
    check (reward_type in ('discount', 'credit', 'manual')),
  -- Which pack was topped up and by how much (credit rewards only)
  add column credit_bought_membership_id bigint,
  add column credits_granted numeric;
