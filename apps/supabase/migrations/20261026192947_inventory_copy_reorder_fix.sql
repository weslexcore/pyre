-- Fix-up for 20261026192124_inventory_simple_list.sql's copy of the old items.
--
-- It capped the copied re-order level with least(i.reorder_level, 100000),
-- but least() ignores nulls, so every old item with no re-order level came
-- across with reorder_at = 100000 and would read as "needs re-order". Put
-- those back to null: no re-order level, as they had before.
--
-- Matched by name to an old active item with no re-order level, so a level
-- someone has since set by hand (even to 100000) is left alone unless it
-- came from that copy.

update public.inventory inv
set reorder_at = null
from public.inventory_items old
where old.active
  and old.reorder_level is null
  and lower(btrim(old.name)) = lower(btrim(inv.name))
  and inv.reorder_at = 100000;
