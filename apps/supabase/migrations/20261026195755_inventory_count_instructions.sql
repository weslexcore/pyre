-- Optional count instructions on each inventory item ("count unopened
-- bottles only", "weigh the tank: full is 38 lb"). Set in the item's details
-- on /admin/inventory and shown when someone presses the item's Due chip to
-- count it. Null = nothing special.

alter table public.inventory
  add column count_instructions text check (char_length(count_instructions) <= 2000);

comment on column public.inventory.count_instructions is
  'How to count this item, shown in the count dialog opened from its Due chip; null = no instructions.';
