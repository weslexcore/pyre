-- Restructure the Guest Policies Cancellations section (v3): general
-- cancelled-by-Pyre rule first, the mid-session weather credit math second,
-- and guest-initiated cancellations (2-hour cutoff) last. Recorded as a
-- normal versioned save. The section is rebuilt wholesale — everything before
-- '## Cancellations' is kept, the section itself is replaced.

with updated as (
  update public.sops
  set
    content_md = split_part(content_md, E'## Cancellations', 1) || $cancellations$## Cancellations

### Cancelled by Pyre

If we cancel a session — for weather, equipment, or anything else on our end — guests automatically receive a credit to their account. Sessions cancelled part-way through are credited by the hour-block rule below.

### Cancelled mid-session for weather

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

### Cancelled by a guest

- **2 or more hours before** the session starts — credit to the guest's account.
- **Less than 2 hours before** — no credit.
$cancellations$,
    current_version = current_version + 1,
    updated_by = 'seed'
  where slug = 'guest-policies'
  returning id, title, content_md, current_version
)
insert into public.sop_versions (sop_id, version, title, content_md, edited_by, change_note)
select id, current_version, title, content_md, 'seed',
  'Restructured Cancellations: by Pyre, mid-session weather, by guest (2-hour cutoff)'
from updated;
