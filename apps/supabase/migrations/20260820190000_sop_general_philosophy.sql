-- Seed the Sauna Steward Philosophy SOP as the first document of a new
-- "General" category, ranked above Opening and Closing so it leads the
-- /admin/sops library. Same access defaults as the other seeds (all staff
-- view, admins edit); prose document rather than a checklist.

insert into public.sop_categories (name, sort_order) values ('General', 0)
on conflict (name) do update set sort_order = 0;

update public.sop_categories set sort_order = 1 where name = 'Opening';
update public.sop_categories set sort_order = 2 where name = 'Closing';

with seeded as (
  insert into public.sops
    (slug, title, content_md, category, view_access, edit_access, sort_order, created_by, updated_by)
  values
    (
      'sauna-steward-philosophy',
      'Sauna Steward Philosophy',
      $philosophy$*Pyre is a space for love.*

## Overview

The goal of Pyre is to provide a space for people to disconnect from technology and reconnect to the present moment, themselves and others. Our responsibility is to facilitate people’s process of reconnection. We do this through high quality care and attentiveness. We want people to feel an effortless sense of warmth and safety when they step through the doors. Sauna and cold bathing can be relaxing, invigorating, and at times challenging; whatever someone's process and experience, what they’re experiencing is normal. We are here to remind our guests that they are enough as they are right now.

## Core Tenants

### The guest’s experience comes first

From the moment a guest walks into our space to the moment they leave we have the opportunity to craft a special experience for them. In this increasingly disconnected world, we cannot underestimate the power of a smile, a friendly face, good conversation, and a safe human-centric experience.

We’re building a new culture in Richmond. For thousands of years sauna and cold plunging have been used to foster stronger community ties, to help people have autonomy over their health, and have been an inclusive space without hierarchy. We want to embody these values, as well as the value of acceptance. We are enough as we are right now. We are growing, we are changing, we may not be who we’d “like to be” right this moment, but we are still enough. That’s what we want to get across to our guests.

The customer is NOT always right, but we are here to serve the customer. Practically speaking, that may look like allowing an old (and experienced) Finnish man to add as much water to the rocks as he’d like in the small sauna. This may look like bringing a customer not one but 3 towels over the course of the session. This may look like asking for a new guest's favorite scent and making sure to infuse it in the next essential oil infusion. This may look like having a nice conversation about a guest’s cat. This may look like leaving someone alone entirely. The key is understanding the goals of our guests, anticipating their needs, and helping them feel supported. Use your best judgment, we trust you.

> How can you be a more active listener? What signs do you see from a customer that help you determine the experience that will best serve them? What thoughtful touches can make someone feel deeply valued?

### We’re here to support and serve the space

Pyre is a sacred space. It’s a safe container for people to go through a variety of experiences. It’s a space that feels like an oasis; this is by design. While we’re setting up and while we’re in session we want to make sure the space is respected, clean and safe.

Keeping the deck dry, wiping spider webs off of furniture, and making sure pine cones and gumballs aren’t in people’s paths is a part of it. Bringing a loving energy into the space and using the opportunity to work in the space as a chance to connect with your higher self is another.

> How can a session become a meditation for you? How can we be better neighbors for the guests coming in the door? How can we better support the team that is helping Pyre run?

### Pyre is a retreat from technology

We live in an increasingly digital world. It’s increasingly hard to escape it (I’m looking at you check-in iPad). We want Pyre to be a space where guests can free themselves from the compulsive use of technology. This becomes increasingly difficult and important as technology enters more and more aspects of our life.

The only way we can ask this of the customer is to model it ourselves. It is okay if you need to check your phone for a moment or take a call. It just needs to happen away from the view of the customer; preferably outside of the space entirely.

> What can you do to ensure you are fully engaging with the guest while still capturing everything required in our software? How can the use of technology be as minimal and frictionless as possible?

## Notes

Pyre is ever-evolving as are the roles that we’re here to fulfill. The above document is intended to frame our goals and to inspire you to be creative in your approach to serving guests. We’re open books so don’t hesitate to share your thoughts, dreams, or concerns.
$philosophy$,
      'General',
      'staff',
      'admin',
      0,
      'seed',
      'seed'
    )
  returning id, title, content_md
)
insert into public.sop_versions (sop_id, version, title, content_md, edited_by, change_note)
select id, 1, title, content_md, 'seed', 'Initial import'
from seeded;
