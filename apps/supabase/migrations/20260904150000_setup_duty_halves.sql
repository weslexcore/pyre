-- Setup splits into halves the same way break down does: Set Up (A) — Fire +
-- Water and Set Up (B) — Space Prep, matching the SOPs of those names. The
-- undivided 'setup' and 'breakdown' duties go away — a solo closer holds both
-- halves, which is what the Break Down SOP already tells them to do.
--
-- The pairing rule the schedule follows (enforced as advice in the board and
-- the scheduler prompt, never in the database): whoever takes A at set-up
-- takes B at break down. Set Up (A) and Break Down (A) are both the fire and
-- water side, so crossing the letters is what keeps one person from working
-- the same corner of the property all day.

-- Translate any rows written under the old vocabulary. The whole-job duties
-- become both halves; the column landed empty a few hours ago, so in practice
-- this touches nothing.
update public.shift_assignments
   set duties = (
     select array_agg(distinct duty order by duty)
       from unnest(duties) as duty
      where duty not in ('setup', 'breakdown')
   ) || case when 'setup' = any (duties) then array['setup_a', 'setup_b'] else '{}' end
      || case when 'breakdown' = any (duties) then array['breakdown_a', 'breakdown_b'] else '{}' end
 where duties && array['setup', 'breakdown'];

update public.sub_requests
   set duties = (
     select array_agg(distinct duty order by duty)
       from unnest(duties) as duty
      where duty not in ('setup', 'breakdown')
   ) || case when 'setup' = any (duties) then array['setup_a', 'setup_b'] else '{}' end
      || case when 'breakdown' = any (duties) then array['breakdown_a', 'breakdown_b'] else '{}' end
 where duties && array['setup', 'breakdown'];

alter table public.shift_assignments
  drop constraint shift_assignments_duties_check,
  add constraint shift_assignments_duties_check check (
    duties <@ array[
      'setup_a',
      'setup_b',
      'host',
      'customer_care',
      'breakdown_a',
      'breakdown_b'
    ]::text[]
  );

alter table public.sub_requests
  drop constraint sub_requests_duties_check,
  add constraint sub_requests_duties_check check (
    duties <@ array[
      'setup_a',
      'setup_b',
      'host',
      'customer_care',
      'breakdown_a',
      'breakdown_b'
    ]::text[]
  );
