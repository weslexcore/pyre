-- Inventory counts: staff count what is actually on the shelves, and the
-- difference from what the ledger expected is recorded as a count adjustment
-- — the unexplained loss (or found stock) the earlier migrations reserved
-- `count_adjust` and `inventory_movements.count_line_id` for.
--
-- How a count works:
--
--   * A *round* (`inventory_counts`, e.g. "October full count") groups the
--     work across one or more areas. It can stay open for days while
--     different people count different areas on different shifts; closing it
--     marks it done. An area can also be counted on its own, with no round.
--   * Each item in a spot is a *line* (`inventory_count_lines`), saved the
--     moment it is entered. Counts are blind: the app does not show the
--     expected number until the line is saved.
--   * Saving a line goes through `inventory_record_count`, which locks that
--     spot's stock row, reads what the ledger expects *at that moment*, and
--     posts the difference. Usage logged while a count is under way is
--     therefore never mistaken for loss, and two people counting the same
--     spot are serialised rather than double-posting.
--   * A difference above the review thresholds (`inventory_settings`,
--     default 20% or $25) still posts immediately, but is marked `pending`
--     for an admin to accept or send back for a recount.

-- ---------------------------------------------------------------------------
-- Review thresholds (one row)
-- ---------------------------------------------------------------------------

create table public.inventory_settings (
  -- Always true: there is exactly one settings row.
  id boolean primary key default true check (id),
  -- A count line goes to review when it is off by more than this percent of
  -- what was expected...
  review_pct numeric not null default 20 check (review_pct >= 0 and review_pct <= 1000),
  -- ...or by more than this many cents of value.
  review_cents integer not null default 2500 check (review_cents >= 0),
  updated_by text,
  updated_at timestamptz not null default now()
);

insert into public.inventory_settings (id) values (true);

create trigger inventory_settings_set_updated_at
  before update on public.inventory_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Rounds
-- ---------------------------------------------------------------------------

create table public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  -- the areas this round covers, in the order they were chosen
  area_ids uuid[] not null check (cardinality(area_ids) between 1 and 100),
  -- open: being counted; closed: done; cancelled: abandoned (lines already
  -- counted keep their adjustments — those were real shelf counts)
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  started_by text not null,
  started_at timestamptz not null default now(),
  closed_by text,
  closed_at timestamptz,
  check ((status = 'open') = (closed_at is null))
);

create index inventory_counts_status_idx on public.inventory_counts (status, started_at desc);

-- ---------------------------------------------------------------------------
-- Lines
-- ---------------------------------------------------------------------------

create table public.inventory_count_lines (
  id uuid primary key default gen_random_uuid(),
  -- null for an area counted on its own, outside a round
  count_id uuid references public.inventory_counts (id) on delete restrict,
  item_id uuid not null references public.inventory_items (id) on delete restrict,
  area_id uuid not null references public.inventory_areas (id) on delete restrict,
  -- what was on the shelf
  counted_qty numeric not null check (counted_qty >= 0),
  -- what the ledger expected, net of anything logged since the line was
  -- first counted (so a re-entry still compares against the same baseline)
  expected_qty numeric not null,
  -- counted - expected: negative is unexplained loss, positive found stock
  variance numeric not null,
  -- variance at the item's unit cost; null when the item has no cost
  variance_cents integer,
  counted_by text not null,
  counted_at timestamptz not null default now(),
  -- none: nothing to review; pending: over a threshold, waiting on an admin;
  -- accepted: an admin agreed; recount: an admin asked for it to be counted
  -- again (re-entering the line re-evaluates it)
  review_status text not null default 'none'
    check (review_status in ('none', 'pending', 'accepted', 'recount')),
  reviewed_by text,
  reviewed_at timestamptz
);

-- One line per spot per round; re-entering it updates the line.
create unique index inventory_count_lines_round_spot_idx
  on public.inventory_count_lines (count_id, item_id, area_id)
  where count_id is not null;

-- "When was this area last counted" and the area's recent lines.
create index inventory_count_lines_area_idx
  on public.inventory_count_lines (area_id, counted_at desc);

-- The admin review list.
create index inventory_count_lines_review_idx
  on public.inventory_count_lines (review_status, counted_at desc)
  where review_status in ('pending', 'recount');

alter table public.inventory_movements
  add constraint inventory_movements_count_line_id_fkey
  foreign key (count_line_id) references public.inventory_count_lines (id) on delete restrict;

create index inventory_movements_count_line_idx
  on public.inventory_movements (count_line_id)
  where count_line_id is not null;

-- ---------------------------------------------------------------------------
-- Recording a count
-- ---------------------------------------------------------------------------

-- Records one counted spot and posts the difference to the ledger, in one
-- transaction. Returns the saved line. Raises (P0001) with a readable message
-- for a closed round, an area outside the round, or a retired item/area.
create or replace function public.inventory_record_count(
  p_count_id uuid,
  p_item_id uuid,
  p_area_id uuid,
  p_counted numeric,
  p_counted_by text
)
returns public.inventory_count_lines
language plpgsql
as $$
declare
  v_round public.inventory_counts;
  v_settings public.inventory_settings;
  v_cost integer;
  v_on_hand numeric;
  v_existing public.inventory_count_lines;
  v_expected numeric;
  v_variance numeric;
  v_variance_cents integer;
  v_adjustment numeric;
  v_review text;
  v_line public.inventory_count_lines;
begin
  if p_counted is null or p_counted < 0 then
    raise exception 'Counted quantity must be 0 or more' using errcode = 'P0001';
  end if;

  if p_count_id is not null then
    select * into v_round from public.inventory_counts where id = p_count_id;
    if not found then
      raise exception 'Count round not found' using errcode = 'P0001';
    end if;
    if v_round.status <> 'open' then
      raise exception 'This count round is %', v_round.status using errcode = 'P0001';
    end if;
    if not (p_area_id = any (v_round.area_ids)) then
      raise exception 'That area is not part of this count round' using errcode = 'P0001';
    end if;
  end if;

  select unit_cost_cents into v_cost
  from public.inventory_items
  where id = p_item_id and active;
  if not found then
    raise exception 'Item not found' using errcode = 'P0001';
  end if;
  perform 1 from public.inventory_areas where id = p_area_id and active;
  if not found then
    raise exception 'Storage area not found' using errcode = 'P0001';
  end if;

  -- The spot's stock row is the lock that serialises this count against
  -- concurrent use/receive and against someone else counting the same spot.
  insert into public.inventory_item_spots (item_id, area_id)
  values (p_item_id, p_area_id)
  on conflict (item_id, area_id) do nothing;
  insert into public.inventory_stock (item_id, area_id, quantity)
  values (p_item_id, p_area_id, 0)
  on conflict (item_id, area_id) do nothing;
  select quantity into v_on_hand
  from public.inventory_stock
  where item_id = p_item_id and area_id = p_area_id
  for update;

  -- What actually changes in stock: the shelf is now p_counted.
  v_adjustment := p_counted - v_on_hand;

  if p_count_id is not null then
    select * into v_existing
    from public.inventory_count_lines
    where count_id = p_count_id and item_id = p_item_id and area_id = p_area_id;
  end if;

  -- The line's baseline. A re-entry keeps the first expectation, moved by
  -- whatever was logged since (on-hand now minus what the line last set it
  -- to), so the line's variance is its total difference, not just the
  -- latest correction.
  if v_existing.id is not null then
    v_expected := v_existing.expected_qty + (v_on_hand - v_existing.counted_qty);
  else
    v_expected := v_on_hand;
  end if;
  v_variance := p_counted - v_expected;
  v_variance_cents := case when v_cost is null then null else round(v_variance * v_cost) end;

  select * into v_settings from public.inventory_settings where id;
  v_review := case
    when v_variance <> 0 and (
      abs(v_variance) * 100 > coalesce(v_settings.review_pct, 20) * v_expected
      or abs(coalesce(v_variance_cents, 0)) > coalesce(v_settings.review_cents, 2500)
    ) then 'pending'
    else 'none'
  end;

  if v_existing.id is not null then
    update public.inventory_count_lines
    set counted_qty = p_counted,
        expected_qty = v_expected,
        variance = v_variance,
        variance_cents = v_variance_cents,
        counted_by = p_counted_by,
        counted_at = now(),
        review_status = v_review,
        reviewed_by = null,
        reviewed_at = null
    where id = v_existing.id
    returning * into v_line;
  else
    insert into public.inventory_count_lines (
      count_id, item_id, area_id, counted_qty, expected_qty, variance,
      variance_cents, counted_by, review_status
    )
    values (
      p_count_id, p_item_id, p_area_id, p_counted, v_expected, v_variance,
      v_variance_cents, p_counted_by, v_review
    )
    returning * into v_line;
  end if;

  -- A recount an admin asked for is answered by any later count of the same
  -- spot, in this round or another (the round it was asked in may be
  -- closed by now).
  update public.inventory_count_lines
  set review_status = 'none', reviewed_by = p_counted_by, reviewed_at = now()
  where item_id = p_item_id
    and area_id = p_area_id
    and review_status = 'recount'
    and id <> v_line.id;

  if v_adjustment <> 0 then
    insert into public.inventory_movements (
      item_id, area_id, movement_type, quantity, unit_cost_cents,
      count_line_id, recorded_by
    )
    values (
      p_item_id, p_area_id, 'count_adjust', v_adjustment, v_cost,
      v_line.id, p_counted_by
    );
  end if;

  return v_line;
end;
$$;

-- Only the app's service role calls this; it trusts p_counted_by.
revoke all on function public.inventory_record_count(uuid, uuid, uuid, numeric, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

-- App access is service-role (bypasses RLS); these admin-select policies are
-- forward-looking convention, same as the other inventory tables.
alter table public.inventory_settings enable row level security;
alter table public.inventory_counts enable row level security;
alter table public.inventory_count_lines enable row level security;

create policy "admins can select inventory settings"
  on public.inventory_settings for select to authenticated using (public.is_admin());
create policy "admins can select inventory counts"
  on public.inventory_counts for select to authenticated using (public.is_admin());
create policy "admins can select inventory count lines"
  on public.inventory_count_lines for select to authenticated using (public.is_admin());

comment on table public.inventory_count_lines is
  'One counted spot (item × area), saved as entered via inventory_record_count, which posts the difference as a count_adjust movement. Blind: the app shows expected_qty only after the line is saved.';
comment on table public.inventory_counts is
  'A count round on /admin/inventory/count: groups lines across areas, can stay open for days; closing marks it done.';
