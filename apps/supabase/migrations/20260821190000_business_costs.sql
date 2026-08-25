-- Operating costs for the business overview (/admin/business): the numbers
-- that sit between revenue and profit which Momence knows nothing about.
-- Admins maintain these by hand from the dashboard; the overview API
-- amortizes them onto ET calendar days and folds them into each bucket's
-- profit math alongside the labor cost computed from the shifts tables.
--
-- One row per cost definition (or one-off purchase). Four kinds, because the
-- building's real costs come in four shapes:
--   recurring           a subscription: `amount` dollars every `cadence`
--                       (software, biweekly laundry service)
--   one_off             a dated purchase for `amount` dollars (a cord of
--                       firewood), attributed to the day it was bought
--   per_open_hour       `amount` dollars per customer-facing open hour,
--                       optionally clamped at `monthly_cap` dollars per
--                       calendar month (rent: $50/session-hour, $4,250 cap)
--   percent_of_revenue  `amount` PERCENT of each day's Momence revenue
--                       (Momence transaction fees)
--
-- Recurring and computed kinds carry an effective window so price changes
-- are recorded as history (close the old row, open a new one) rather than
-- edits that silently rewrite past months' profit.
--
-- Access model: admin-only, like everything else on /admin/business —
-- revenue, labor, and rent together are the whole P&L.

create table public.business_costs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0 and char_length(name) <= 120),
  category text not null check (
    category in ('rent', 'software', 'supplies', 'services', 'fees', 'other')
  ),
  kind text not null check (
    kind in ('recurring', 'one_off', 'per_open_hour', 'percent_of_revenue')
  ),
  -- Meaning depends on kind (see header): dollars per cadence period, total
  -- dollars, dollars per open hour, or a percentage.
  amount numeric not null check (amount > 0),
  cadence text check (cadence in ('weekly', 'biweekly', 'monthly', 'yearly')),
  -- per_open_hour only: most a calendar month may accrue, in dollars.
  monthly_cap numeric check (monthly_cap > 0),
  -- one_off only: the ET day the purchase lands on.
  incurred_on date,
  -- Recurring/computed kinds: the window the definition applies to.
  -- Null from = since forever; null to = still active.
  effective_from date,
  effective_to date,
  notes text check (char_length(notes) <= 500),
  -- Email from the Momence session, never the request body.
  created_by text not null check (char_length(created_by) between 3 and 320),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Each kind uses exactly the columns that make sense for it.
  constraint business_costs_kind_shape check (
    (kind = 'recurring' and cadence is not null and incurred_on is null
      and monthly_cap is null)
    or (kind = 'one_off' and incurred_on is not null and cadence is null
      and monthly_cap is null and effective_from is null and effective_to is null)
    or (kind = 'per_open_hour' and cadence is null and incurred_on is null)
    or (kind = 'percent_of_revenue' and cadence is null and incurred_on is null
      and monthly_cap is null)
  ),
  -- A percentage over 100 is a typo, not a fee schedule.
  constraint business_costs_percent_bounded check (
    kind <> 'percent_of_revenue' or amount <= 100
  ),
  constraint business_costs_window_ordered check (
    effective_from is null or effective_to is null or effective_to >= effective_from
  )
);

create trigger business_costs_set_updated_at
  before update on public.business_costs
  for each row execute function public.set_updated_at();

alter table public.business_costs enable row level security;

-- App access is service-role (bypasses RLS); forward-looking convention like
-- the other admin tables.
create policy "admins can select business costs"
  on public.business_costs for select
  using (public.is_admin());

create policy "admins can insert business costs"
  on public.business_costs for insert
  with check (public.is_admin());

create policy "admins can update business costs"
  on public.business_costs for update
  using (public.is_admin());

create policy "admins can delete business costs"
  on public.business_costs for delete
  using (public.is_admin());

comment on table public.business_costs is
  'Admin-entered operating costs (/admin/business): recurring subscriptions, one-off purchases, per-open-hour rent with a monthly cap, and percent-of-revenue fees, amortized into the business overview profit math.';
