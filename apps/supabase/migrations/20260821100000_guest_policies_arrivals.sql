-- Guest Policies v4: add the no-show rule to the guest-cancellation list and
-- a new Arrivals section (rolling admission, last-entry cutoff, special-event
-- arrival windows). Plain append — v3 ends with the guest-cancellation list,
-- so the no-show bullet joins it and Arrivals follows as a new section.

with updated as (
  update public.sops
  set
    content_md = content_md || $arrivals$- **No-show** — no credit.

## Arrivals

- Sessions are **rolling admission** — arriving any time during an open-hours slot is fine.
- **Last entry is 1 hour before close.** Guests may still enter after that, as long as they understand it still costs a full credit.
- Some special events have an **explicit arrival time**. For those, arrivals more than 10 minutes late may be turned away, at the discretion of the practitioner and the check-in person.
$arrivals$,
    current_version = current_version + 1,
    updated_by = 'seed'
  where slug = 'guest-policies'
  returning id, title, content_md, current_version
)
insert into public.sop_versions (sop_id, version, title, content_md, edited_by, change_note)
select id, current_version, title, content_md, 'seed',
  'Added no-show rule and Arrivals section (rolling admission, last entry, special events)'
from updated;
