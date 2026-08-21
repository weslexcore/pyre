-- Seed the two on-shift duty SOPs — Host and Customer Care — in a new
-- "On Shift" category ranked between Opening and Closing (the shape of a
-- shift: set up, work the session, break down). Same access defaults as the
-- other seeds (all staff view, admins edit). Ongoing responsibilities rather
-- than run-through checklists, so plain nested bullets instead of task boxes.

insert into public.sop_categories (name, sort_order) values ('On Shift', 2)
on conflict (name) do update set sort_order = 2;

update public.sop_categories set sort_order = 3 where name = 'Closing';

with seeded as (
  insert into public.sops
    (slug, title, content_md, category, view_access, edit_access, sort_order, created_by, updated_by)
  values
    (
      'host-responsibilities',
      'Host Responsibilities',
      $host$## Core

The core of this role is to be the first smiling face that greets guests as they step into Pyre. This is arguably the most important part of the guest’s journey, meeting a smiling and helpful face can set the tone for the entire experience.

- Check-in process
  - Greet guests with a smile and introduction — learn their name
  - Check them in and make sure waivers are signed
  - Process payment
  - Explain the space depending on guests experience level and their newness
    - If customer care person is free, direct new guests to them for a tour
  - Make it clear that we’re tech free, tell them to leave phones in the cubbies
  - Provide towels (leave spares on desk when away)
- Sales
  - Drink sales
  - Merch
  - Membership / credit sales
- End of guest session
  - Offer fresh towels
  - Thank them for coming, send them off the same way they came in with a smile, use their name as well.
  - For customers that enjoyed their experience ask them to leave a review
  - Mention membership and credit pack options if it makes sense

## Secondary

- Make sure water is filled and that there are enough cups
- Squeegee when customers aren’t on the deck, or if the session is busy, when they aren’t in the plunge
- Support Customer Care upon request
- Guide customers to the restroom
- Empty hampers when 3/4 full

## Notes

- As stated above this is one of the most important parts of the guest experience and sets the tone for the entire session.
  - *What can you learn about a customer? How can you make them feel safe and cared for? What questions can you answer that allow them to relax into the experience a bit more?*
- Share what you learn with Customer Care
  - *Is there something that can make a guest’s experience special?*
- Just because the role is centered around the front desk doesn’t mean that you need to stay planted. In slow moments, or in the middle of a session (when people aren’t checking in or out) feel free to float and support Customer Care when needed.
  - *What can you do to support customer care?*
  - *If you were a guest, is there anything that would look out of place, untidy or unintentional?*
- Understanding the philosophy behind pricing is important, talk to Wes and Julien if it’s unclear. Simply put: credit packs are perfect for sharing, memberships are great if you’re wanting to incorporate the practice into your life.
$host$,
      'On Shift',
      'staff',
      'admin',
      1,
      'seed',
      'seed'
    ),
    (
      'customer-care-responsibilities',
      'Customer Care Responsibilities',
      $care$## Core

Your core responsibility is to ensure guests have a safe and fulfilling experience at Pyre. You will be maintaining the cleanliness and safety of the saunas and cold plunges while finding moments to engage with guests to help meet their needs.

- Guest Care
  - Make sure guests understand the flow of the space
  - Understand guest’s experience levels with each modality, offer support if needed.
  - Guide new guests through the space, use this as a touch point to learn about them and their needs.
  - Provide new towels and water upon request
  - Use your best judgement, if there is a way to make a customer’s experience more special, then you’re welcome to oblige, so long as everyone is safe and consents.
- Saunas
  - Ensure saunas remain at proper temperature
    - 180–190 for Finnish sauna
    - 190+ for tent
  - Steam sauna ONLY once per hour
    - Full ladle for the big sauna
    - Half ladle (or slightly less) for the tent
  - Cleaning (as needed)
    - Wipe sauna benches (when customers are not present)
    - Mop anteroom
    - Mop sauna
    - Wipe sauna glass
  - Towards the end of session
    - Last wood added 45 minutes before end of session
    - Dampers closed 15 minutes before end of session
- Cold Plunges
  - Remove cold plunge covers for guests, re-cover when guests are not using them
  - Maintenance (as needed)
    - Use skimmer + vacuum when clear of customers
    - Ensure intakes are clear (cut power off to clean)
    - Wipe sides / tops

## Secondary

- Squeegee deck when free of customers
  - If it’s particularly busy, wait until people are out of the cold plunge
- Shower at proper temperature — under 110, above 95
- Water dispensers filled + cups + sharpie set out
- Hampers emptied when ¾ full
- Lights turned on as needed
- Pick up trash / unused towels

## Notes

- Don’t get stuck in the tasks — the core of this role is to support a guest’s journey through the space. Everyone who comes through the doors, regardless of how they’ve shown up, are welcome exactly as they are. We’re not here to optimize, we’re here to accept and celebrate the little wins (even if that’s a 1 second cold plunge).
- Read the room, some people want quiet, others want conversation, some people need guidance, others want to figure things out on their own. Emotional intelligence is the name of the game here. If a customer needs quiet, invite them to the tent sauna, tell people who follow that the tent is for silence today. Is it someone’s birthday? How can we make them feel a little more special? Is someone new to Richmond? Can you recommend restaurants that they need to check out. Someone drops a towel, bring them a fresh one, no questions asked. The point is to be warm and help people feel seen and welcomed.
- You don’t need to be an expert on sauna and cold plunge benefits (although we encourage you to learn the basics of [sauna](https://pyresauna.com/blog/sauna-health-benefits) and [cold](https://pyresauna.com/blog/cold-plunge-benefits)), when in doubt lean into your own experience: how do you feel when you plunge, what helps you deal with the cold? Why do you like to sauna? What’s most exciting about the practice to you? For the questions that you don’t have answers to, don’t be afraid to say you don’t know and direct them to Wes or Julien.
$care$,
      'On Shift',
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
