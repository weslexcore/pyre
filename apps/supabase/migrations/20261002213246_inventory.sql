-- Operational inventory: the supplies the space runs on (towels, cleaning
-- chemicals, water-test reagents, paper goods), tracked per storage spot,
-- written by staff from the /admin/inventory page in apps/integrations.
--
-- The design is a stock ledger. Nobody ever overwrites "how many we have":
-- every change is an append-only row in `inventory_movements` with a signed
-- quantity and a type saying *why* it changed. That buys three things:
--
--   * Several people can work at once. Two staff logging "used 2 towels" at
--     the same moment each insert a -2; neither clobbers the other.
--   * Stock over time. The level on any past date is a running total of the
--     ledger up to that date.
--   * Loss tracking. `use` (taken out to be used) is kept apart from `waste`
--     (known loss: broken, expired) and `count_adjust` (a count found fewer
--     than the ledger expected — unexplained loss), so shrinkage is visible.
--
-- Five tables:
--
--   * `inventory_areas`      — storage areas (back closet, laundry shelf), in
--                              the order someone walks them on a count.
--   * `inventory_items`      — what we stock, how it is bought (lot size) and
--                              when to re-order. `kind` is 'operational' for
--                              now; retail/merch joins later by widening the
--                              check constraint.
--   * `inventory_item_spots` — which areas an item lives in, and its shelf
--                              order within each. One item can sit in several.
--   * `inventory_stock`      — cached on-hand per (item, area), maintained by
--                              a trigger on the ledger. The ledger stays the
--                              source of truth; `inventory_stock_drift` shows
--                              any disagreement.
--   * `inventory_movements`  — the ledger itself.
--
-- Count rounds, the review queue, and re-orders arrive in later migrations;
-- `count_line_id` on the ledger is reserved for them.

-- ---------------------------------------------------------------------------
-- Storage areas
-- ---------------------------------------------------------------------------

create table public.inventory_areas (
  id uuid primary key default gen_random_uuid(),
  -- what staff call it: "Back closet", "Laundry shelf", "Front desk drawer"
  name text not null check (length(btrim(name)) between 1 and 80),
  -- where it is / how to find it, for someone new on shift
  description text check (char_length(description) <= 500),
  -- walk order through the space on a count (ascending)
  sort_order integer not null default 0,
  -- how often this area should be counted, in days (7 = weekly); null = no
  -- schedule. Drives the Due / Overdue status on the count screen.
  count_every_days integer check (count_every_days between 1 and 365),
  -- retired areas drop out of the walk but keep their history
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Two active areas with the same name would make the walk ambiguous.
create unique index inventory_areas_active_name_idx
  on public.inventory_areas (lower(btrim(name)))
  where active;

create trigger inventory_areas_set_updated_at
  before update on public.inventory_areas
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------------

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  -- 'operational' = used to run the space, never sold. Retail stock will be
  -- added as another kind; reports and lists filter on it.
  kind text not null default 'operational' check (kind in ('operational')),
  -- free-text grouping for the setup list and reports: "Cleaning", "Linens"
  category text check (char_length(category) <= 60),
  -- the unit everything is counted in: "towel", "bottle", "roll"
  unit text not null default 'each' check (length(btrim(unit)) between 1 and 30),
  -- how it is bought: lot_size units per lot, e.g. 12 per "case"
  lot_size numeric not null default 1 check (lot_size > 0),
  lot_label text check (char_length(lot_label) <= 30),
  -- re-order when total on-hand (all spots) falls to or below this
  reorder_level numeric check (reorder_level >= 0),
  -- fill-to level after a re-order; the suggested order rounds
  -- (reorder_target - on_hand) up to whole lots
  reorder_target numeric check (reorder_target >= 0),
  -- current cost of one unit (not one lot), in cents; snapshotted onto each
  -- ledger row so historic loss keeps the price it had at the time
  unit_cost_cents integer check (unit_cost_cents >= 0),
  vendor text check (char_length(vendor) <= 120),
  vendor_url text check (char_length(vendor_url) <= 500),
  notes text check (char_length(notes) <= 2000),
  -- retired items drop out of lists and counts but keep their history
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reorder_target is null or reorder_level is null or reorder_target >= reorder_level)
);

create unique index inventory_items_active_name_idx
  on public.inventory_items (lower(btrim(name)))
  where active;

create trigger inventory_items_set_updated_at
  before update on public.inventory_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Where each item lives
-- ---------------------------------------------------------------------------

create table public.inventory_item_spots (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items (id) on delete cascade,
  area_id uuid not null references public.inventory_areas (id) on delete cascade,
  -- shelf order within the area on a count (ascending)
  sort_order integer not null default 0,
  -- optional "keep this many here" for restocking a spot from back stock
  par_level numeric check (par_level >= 0),
  created_at timestamptz not null default now(),
  unique (item_id, area_id)
);

create index inventory_item_spots_area_idx
  on public.inventory_item_spots (area_id, sort_order);

-- ---------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items (id) on delete restrict,
  area_id uuid not null references public.inventory_areas (id) on delete restrict,
  -- why stock changed:
  --   initial      + opening balance when an item/spot is first set up
  --   receive      + delivery arrived / restocked
  --   use          - taken out to be used in operations (usage)
  --   waste        - known loss: broken, expired, contaminated (reason required)
  --   count_adjust ± a count found more/fewer than the ledger expected
  --                  (negative = unexplained loss)
  --   transfer     ± moved between spots; two rows sharing transfer_group
  --   correction   ± an admin fixing a mis-entry; excluded from usage/loss
  movement_type text not null check (movement_type in (
    'initial', 'receive', 'use', 'waste', 'count_adjust', 'transfer', 'correction'
  )),
  -- signed change in the item's unit
  quantity numeric not null check (quantity <> 0),
  -- the item's unit cost when this happened, so loss in $ stays historic
  unit_cost_cents integer check (unit_cost_cents >= 0),
  -- short why: required for waste ("expired", "broken"); optional otherwise
  reason text check (char_length(reason) <= 120),
  note text check (char_length(note) <= 1000),
  -- both legs of a move share one id
  transfer_group uuid,
  -- the count line that produced a count_adjust (count rounds land later)
  count_line_id uuid,
  -- session email of whoever logged it — never taken from a request body
  recorded_by text not null,
  -- when it happened (defaults to when it was logged)
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  -- Each type moves stock in one direction only, so a "use" can't add stock.
  check (
    (movement_type in ('initial', 'receive') and quantity > 0)
    or (movement_type in ('use', 'waste') and quantity < 0)
    or movement_type in ('count_adjust', 'transfer', 'correction')
  ),
  check (movement_type <> 'waste' or length(btrim(coalesce(reason, ''))) > 0),
  check (movement_type <> 'correction' or length(btrim(coalesce(note, ''))) > 0),
  check ((movement_type = 'transfer') = (transfer_group is not null))
);

-- Item history and the stock-over-time chart.
create index inventory_movements_item_idx
  on public.inventory_movements (item_id, occurred_at desc);
-- The ledger view and the usage / loss reports by type and period.
create index inventory_movements_occurred_idx
  on public.inventory_movements (occurred_at desc);
create index inventory_movements_type_idx
  on public.inventory_movements (movement_type, occurred_at desc);
create index inventory_movements_transfer_idx
  on public.inventory_movements (transfer_group)
  where transfer_group is not null;

-- ---------------------------------------------------------------------------
-- Cached on-hand per spot
-- ---------------------------------------------------------------------------

create table public.inventory_stock (
  item_id uuid not null references public.inventory_items (id) on delete cascade,
  area_id uuid not null references public.inventory_areas (id) on delete cascade,
  -- Never negative: a movement that would take a spot below zero fails, and
  -- because the ledger insert and this update are one statement, the
  -- movement is rejected with it. That is what keeps two people taking the
  -- last towel at the same time honest — the row lock serialises them and
  -- the second one is told there are none left.
  quantity numeric not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (item_id, area_id)
);

create index inventory_stock_area_idx on public.inventory_stock (area_id);

-- Apply each ledger row to the cache. Also makes sure the item has a spot in
-- that area, so receiving into a new place puts the item on that area's walk.
create or replace function public.inventory_apply_movement()
returns trigger
language plpgsql
as $$
begin
  insert into public.inventory_item_spots (item_id, area_id)
  values (new.item_id, new.area_id)
  on conflict (item_id, area_id) do nothing;

  -- Update-then-insert rather than `insert ... on conflict do update`: the
  -- check constraint is tested against the proposed insert row first, so a
  -- negative movement on an existing spot would fail even with stock on hand.
  -- The loop covers two first-ever movements for one spot racing each other.
  loop
    update public.inventory_stock
      set quantity = quantity + new.quantity, updated_at = now()
      where item_id = new.item_id and area_id = new.area_id;
    exit when found;
    begin
      insert into public.inventory_stock (item_id, area_id, quantity)
      values (new.item_id, new.area_id, new.quantity);
      exit;
    exception when unique_violation then
      -- someone else created the row; go round and update it
    end;
  end loop;

  return new;
end;
$$;

create trigger inventory_movements_apply
  after insert on public.inventory_movements
  for each row execute function public.inventory_apply_movement();

-- The ledger is append-only. A mistake is fixed with a correction row, so the
-- record of what was logged (and by whom) is never rewritten.
create or replace function public.inventory_movements_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'inventory_movements is append-only; log a correction instead'
    using errcode = 'P0001';
end;
$$;

create trigger inventory_movements_no_update
  before update or delete on public.inventory_movements
  for each row execute function public.inventory_movements_append_only();

-- Any (item, area) whose cached on-hand disagrees with its ledger. Should
-- always be empty; a row here means the cache needs rebuilding.
create view public.inventory_stock_drift
with (security_invoker = true)
as
select
  coalesce(s.item_id, l.item_id) as item_id,
  coalesce(s.area_id, l.area_id) as area_id,
  coalesce(s.quantity, 0) as cached_quantity,
  coalesce(l.quantity, 0) as ledger_quantity
from public.inventory_stock s
full join (
  select item_id, area_id, sum(quantity) as quantity
  from public.inventory_movements
  group by item_id, area_id
) l on l.item_id = s.item_id and l.area_id = s.area_id
where coalesce(s.quantity, 0) <> coalesce(l.quantity, 0);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

-- App access is service-role (bypasses RLS); these admin-select policies are
-- forward-looking convention, same as the other tables.
alter table public.inventory_areas enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_item_spots enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.inventory_stock enable row level security;

create policy "admins can select inventory areas"
  on public.inventory_areas for select to authenticated using (public.is_admin());
create policy "admins can select inventory items"
  on public.inventory_items for select to authenticated using (public.is_admin());
create policy "admins can select inventory item spots"
  on public.inventory_item_spots for select to authenticated using (public.is_admin());
create policy "admins can select inventory movements"
  on public.inventory_movements for select to authenticated using (public.is_admin());
create policy "admins can select inventory stock"
  on public.inventory_stock for select to authenticated using (public.is_admin());

comment on table public.inventory_movements is
  'Append-only stock ledger for /admin/inventory. Signed quantity per (item, area); movement_type says why (use vs waste vs count_adjust keeps usage apart from loss). inventory_stock is a trigger-maintained cache of its sums.';
comment on table public.inventory_stock is
  'On-hand per (item, area), maintained by the inventory_movements_apply trigger. Never written directly. See inventory_stock_drift.';
