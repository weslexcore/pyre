-- Seed the space policies as two General-category SOPs — Guest Policies and
-- Staff Policies — after the Sauna Steward Philosophy. The source list mixed
-- audiences; the split here assigns each rule to whoever it addresses: the
-- staff-only phone rule leads Staff Policies (which also points at the guest
-- document, since every space rule binds staff too), and the space-wide
-- technology and food + drink rules live in Guest Policies. Same access
-- defaults as the other seeds (all staff view, admins edit).

with seeded as (
  insert into public.sops
    (slug, title, content_md, category, view_access, edit_access, sort_order, created_by, updated_by)
  values
    (
      'guest-policies',
      'Guest Policies',
      $guest$## Technology

- Phones stay in cubby / lounge area
- No headphones
- No laptops / tablets — they can be used in picnic area if needed

## Food + Drink

- No glass in the space
- Snacks fine in lounge — anything beyond a light snack can be eaten at the picnic tables
- Private rental — fine to bring food + drink to share, please request ahead of time
$guest$,
      'General',
      'staff',
      'admin',
      1,
      'seed',
      'seed'
    ),
    (
      'staff-policies',
      'Staff Policies',
      $staff$Everything in [Guest Policies](/admin/sops/guest-policies) applies to staff as well. In addition:

## Technology

- Do not use your phone inside the space with customers present — step outside to call as needed
- No headphones while on shift
- Phones stay in the cubby / lounge area
$staff$,
      'General',
      'staff',
      'admin',
      2,
      'seed',
      'seed'
    )
  returning id, title, content_md
)
insert into public.sop_versions (sop_id, version, title, content_md, edited_by, change_note)
select id, 1, title, content_md, 'seed', 'Initial import'
from seeded;
