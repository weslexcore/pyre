-- Inventory: where each item lives, and a history of every change.
--
-- location: optional free text ("Back storage, shelf 2"), shown in the count
-- dialog so whoever is counting knows where to look.
--
-- inventory_history: one row per change to an item, written by
-- /api/admin/inventory. It records who changed what (each field's before and
-- after), and the stock on hand after the change, so the same rows give
-- the item's change log and its stock over time. Usage rates come from the
-- stock series: a drop between two looks at the shelf is what was used, and
-- a rise is a restock (lib/inventory/rules.ts usageOf).
--
-- Repeated saves by one person within a few minutes merge into their latest
-- row, so autosaving a form, or fixing a typo in a count, reads as one change.

alter table public.inventory
  add column location text check (char_length(location) between 1 and 120);

comment on column public.inventory.location is
  'Where the item is kept, shown in the count dialog; null = not set.';

create table public.inventory_history (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory (id) on delete cascade,
  --   add     the item was created
  --   edit    someone changed it (a count is an edit of in_stock, even to
  --           the same number)
  --   import  copied from the first inventory's stock ledger
  action text not null check (action in ('add', 'edit', 'import')),
  -- { "<field>": { "from": <before>, "to": <after> } } for each field that
  -- changed; {} for a count that found the same number
  changes jsonb not null default '{}'::jsonb,
  -- stock on hand after this change
  in_stock numeric not null check (in_stock >= 0 and in_stock <= 100000),
  changed_by text not null,
  changed_at timestamptz not null default now()
);

comment on table public.inventory_history is
  'Every change to an /admin/inventory item: who, when, each field before and after, and the stock after. Feeds the item''s history tab and its usage rate.';

create index inventory_history_item_idx
  on public.inventory_history (item_id, changed_at desc);
create index inventory_history_changed_idx
  on public.inventory_history (changed_at desc);

-- ---------------------------------------------------------------------------
-- Import the first inventory's stock history
-- ---------------------------------------------------------------------------

-- The old ledger (inventory_movements) holds every stock change. Its running
-- total at the end of each studio day, per item, becomes one history row, so
-- usage rates start with the history the studio already has. Items are
-- matched to the new list by name, as when they were copied across.
insert into public.inventory_history (item_id, action, changes, in_stock, changed_by, changed_at)
select
  daily.inventory_id,
  'import',
  jsonb_build_object('in_stock', jsonb_build_object(
    'from', lag(daily.total) over (partition by daily.inventory_id order by daily.last_at),
    'to', daily.total
  )),
  daily.total,
  daily.last_by,
  daily.last_at
from (
  select
    per_day.inventory_id,
    per_day.last_at,
    per_day.last_by,
    least(greatest(
      sum(per_day.day_change) over (partition by per_day.inventory_id order by per_day.last_at),
      0), 100000) as total
  from (
    select
      n.id as inventory_id,
      sum(m.quantity) as day_change,
      max(m.occurred_at) as last_at,
      (array_agg(m.recorded_by order by m.occurred_at desc))[1] as last_by
    from public.inventory_movements m
    join public.inventory_items i on i.id = m.item_id
    join public.inventory n on lower(btrim(n.name)) = lower(btrim(i.name))
    group by n.id, (m.occurred_at at time zone 'America/New_York')::date
  ) per_day
) daily;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

-- App access is service-role (bypasses RLS), gated in-route by the
-- /admin/inventory page grant; these policies are the forward-looking
-- convention, same as public.inventory.
alter table public.inventory_history enable row level security;

create policy "admins can select inventory history"
  on public.inventory_history for select
  using (public.is_admin());

create policy "admins can insert inventory history"
  on public.inventory_history for insert
  with check (public.is_admin());

create policy "admins can update inventory history"
  on public.inventory_history for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins can delete inventory history"
  on public.inventory_history for delete
  using (public.is_admin());
