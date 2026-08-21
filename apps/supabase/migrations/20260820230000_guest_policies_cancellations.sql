-- Append a Cancellations section to the Guest Policies SOP, recorded as a
-- proper v2 save in the version history (edited_by 'seed', like the imports).
--
-- The wording restates the source checklist's examples as one explicit rule:
-- bookings count in 1-hour blocks, and a block is "delivered" once 45 minutes
-- of it have passed; credits cover the undelivered blocks. Both worked
-- examples from the source reproduce under this rule.

with updated as (
  update public.sops
  set
    content_md = content_md || $cancellations$
## Cancellations

### Weather

We cancel sessions when there is thunder or other extreme weather — safety comes first, and cancellations are at our discretion.

When a session is cancelled part-way through, guests are credited for the time they didn't get:

- Bookings count in 1-hour blocks (a 2-hour booking is two blocks).
- An hour block counts as **delivered** once 45 minutes of it have passed.
- Guests receive **1 credit for each hour block that wasn't delivered**.

Examples:

| Booking | Cancelled at 2:30p | Cancelled at 2:50p |
| --- | --- | --- |
| 1p–3p | 1 credit | No credit |
| 2p–3p | 1 credit | No credit |
| 2p–4p | 2 credits | 1 credit |
$cancellations$,
    current_version = current_version + 1,
    updated_by = 'seed'
  where slug = 'guest-policies'
  returning id, title, content_md, current_version
)
insert into public.sop_versions (sop_id, version, title, content_md, edited_by, change_note)
select id, current_version, title, content_md, 'seed', 'Added Cancellations section (weather credits)'
from updated;
