-- Seed four more SOPs (see the sops migration for the schema): the full
-- set-up checklist, the full breakdown, and the breakdown split into its two
-- one-person shifts. Same access defaults as the first seeds: viewable by all
-- staff, editable by admins. "Full Setup" joins the two Set Up (A)/(B) docs
-- in Opening; the breakdowns get their own Closing category.
--
-- Note: the source Full Setup checklist repeated five "Social + Tech" items
-- verbatim under "Misc."; the duplicates are dropped here and Misc. keeps
-- only its unique items.

with seeded as (
  insert into public.sops
    (slug, title, content_md, category, view_access, edit_access, sort_order, created_by, updated_by)
  values
    (
      'full-setup',
      'Full Setup',
      $full_setup$- [ ] Turn on garden hose

## Large Sauna

- [ ] Uncover wood + stage wood under anteroom bench
- [ ] Clear ash from inside sauna stove + tray into ash bucket
- [ ] Light fire using fatwood + propane torch
- [ ] Ensure sauna benches + floor are clean
- [ ] Wipe glass in sauna

## Small Sauna

- [ ] Stage wood in firewood holder
- [ ] Set up chimney
- [ ] Clear ash from inside stove
- [ ] Light using fatwood + propane
- [ ] Ensure sauna benches + ground are clean
- [ ] Ensure roof of tent is clear

## Plunges

- [ ] Ensure both are on + water level high enough
- [ ] Check plunge TA + pH + Cl adjust accordingly
- [ ] Vacuum plunge + ensure filter basket and intakes are clear
- [ ] Bee season? Ensure bee baths have plunge water
- [ ] Re-cover plunges

## Back of House

- [ ] Turn on shower propane
- [ ] Set up towel hamper in back of house
- [ ] Wipe privacy screens
- [ ] Wipe chairs + table near sauna

## Check-in / Changing

- [ ] Stage check-in box + towels in social area (can remove when not in sauna)
- [ ] Wipe mirror
- [ ] Sweep or blow changing + cubbies + check-in
- [ ] Wipe cubbies + changing + check-in with microfiber + spray
- [ ] Scrub brush changing + check-in deck
- [ ] Hang curtains + set up wet bags, q-tips and hair ties + set up trash can
- [ ] Pull out candles + therma-cells
- [ ] Night session? — pull out lights
- [ ] Pull out laundry hampers
- [ ] Pull fresh bag of towels as needed

## Sauna Progress

- [ ] Check sauna progress / add wood

## Deck

- [ ] Move + wipe down furniture
- [ ] Sweep / blow deck
- [ ] Mop deck
- [ ] Normal event? — furniture, speakers, lights, towel holders on deck
- [ ] Special event? — stage deck items outside sauna

## Social + Tech

- [ ] Pull out social area cushions + wipe social area furniture
- [ ] Fill water dispenser at front desk and in sauna + pull out drinks to cooler
- [ ] Set up WiFi + card reader + iPad + EcoFlow
- [ ] Fold towels under desk
- [ ] Charge blower batteries

## Misc.

- [ ] Sweep / Swiffer / vacuum sauna anteroom
- [ ] Fill sauna bucket from shower
- [ ] Large session? — light fire pit
- [ ] Pick up pine cones / gumballs / trash
$full_setup$,
      'Opening',
      'staff',
      'admin',
      0,
      'seed',
      'seed'
    ),
    (
      'break-down',
      'Break Down',
      $break_down$> With 2 people, either pick a breakdown shift or flip a coin. Otherwise, the following should be completed in order.

## Plunges

*Refer to the cold plunge manual.*

- [ ] End of week + 2 weeks since last fill + water is cloudy? Drain + refill

## Fire Pit

- [ ] Spread the logs and coals using poker
- [ ] Use ash / sand to dampen

## Small Sauna

- [ ] Close damper
- [ ] Wipe benches

## Large Sauna

- [ ] Close ash pan + damper
- [ ] Wipe sauna + anteroom benches
- [ ] Mop + vacuum hot room and anteroom
- [ ] Empty sauna water bucket
- [ ] Turn off sauna lights

## Plunges

*Refer to the cold plunge manual.*

- [ ] If drained, refill
- [ ] Check TA, pH, Cl
- [ ] Heavy use / cloudy water? Add shock treatment
- [ ] Lock plunges

## Check-in

- [ ] Check for Lost + Found and trash
- [ ] Put away:
  - [ ] Changing room curtains
  - [ ] Hair ties, Q-tips, wet bags, clock
  - [ ] Lights
  - [ ] Menus
  - [ ] Technology
  - [ ] Extra towels
- [ ] Clear towel hampers + put on sauna bench (do not stack)

## Social Area

- [ ] Put away cushions
- [ ] Cover wood

## Deck

- [ ] Squeegee deck
- [ ] Put away:
  - [ ] Lights
  - [ ] Towel holders
  - [ ] Folding chairs
  - [ ] Speakers

## Small Sauna

- [ ] **Ensure fire is out!**
  - [ ] Using fire gloves, remove chimney
  - [ ] Cover chimney hole
- [ ] Lock sauna door

## Final

- [ ] Empty water
- [ ] Drinks away
- [ ] Charge EcoFlow inside Living Water entry
- [ ] Shower off — propane, splitter and hose
- [ ] Check propane levels
- [ ] Cover fire pit if cool
- [ ] Lock large sauna
- [ ] Trash out
- [ ] Turn off lights
$break_down$,
      'Closing',
      'staff',
      'admin',
      1,
      'seed',
      'seed'
    ),
    (
      'break-down-a-fire-and-water',
      'Break Down (A) — Fire + Water',
      $break_down_a$## Plunges

*Refer to the cold plunge manual.*

- [ ] End of week + 2 weeks since last fill + water is cloudy? Drain + refill

## Fire Pit

- [ ] Spread the logs and coals using poker
- [ ] Use ash / sand to dampen

## Small Sauna

- [ ] Close damper
- [ ] Wipe benches

## Large Sauna

- [ ] Close ash pan + damper
- [ ] Wipe sauna + anteroom benches
- [ ] Mop + vacuum hot room and anteroom
- [ ] Empty sauna water bucket
- [ ] Turn off sauna lights

## Plunges

*Refer to the cold plunge manual.*

- [ ] If drained, refill
- [ ] Check TA, pH, Cl
- [ ] Heavy use / cloudy water? Add shock treatment
- [ ] Lock plunges

## Small Sauna

- [ ] **Ensure fire is out!**
  - [ ] Using fire gloves, remove chimney
  - [ ] Cover chimney hole
- [ ] Lock sauna door

## Final

- [ ] Shower off — propane, splitter and hose
- [ ] Check propane levels
- [ ] Cover fire pit if cool
- [ ] Lock large sauna
$break_down_a$,
      'Closing',
      'staff',
      'admin',
      2,
      'seed',
      'seed'
    ),
    (
      'break-down-b-guest-areas',
      'Break Down (B) — Guest Areas',
      $break_down_b$## Check-in

- [ ] Check for Lost + Found and trash
- [ ] Put away:
  - [ ] Changing room curtains
  - [ ] Hair ties, Q-tips, wet bags, clock
  - [ ] Lights
  - [ ] Menus
  - [ ] Technology
  - [ ] Extra towels
- [ ] Clear towel hampers + put on sauna bench (do not stack them)

## Social Area

- [ ] Put away cushions in sauna
- [ ] Cover wood

## Deck

- [ ] Squeegee deck
- [ ] Put away:
  - [ ] Lights
  - [ ] Towel holders
  - [ ] Folding chairs
  - [ ] Speakers

## Final

- [ ] Charge EcoFlow
- [ ] Empty water
- [ ] Drinks away
- [ ] Trash out
- [ ] Turn off lights
$break_down_b$,
      'Closing',
      'staff',
      'admin',
      3,
      'seed',
      'seed'
    )
  returning id, title, content_md
)
insert into public.sop_versions (sop_id, version, title, content_md, edited_by, change_note)
select id, 1, title, content_md, 'seed', 'Initial import'
from seeded;
