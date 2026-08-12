-- Referral reward consumption moves from "the referrer's next session
-- booking" to "the payment transaction where the reward price rule actually
-- fired" (payment-transaction-succeeded webhook + GET
-- /host/payment-transactions/{id}, which records the priceRuleId behind every
-- discount). Record which transaction consumed the reward.
alter table public.referral_rewards
  add column consumed_payment_transaction_id bigint;
