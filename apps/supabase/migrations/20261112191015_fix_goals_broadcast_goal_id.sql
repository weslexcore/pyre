-- Fix goals_broadcast, which made every write to public.goals fail with
-- `record "r" has no field "goal_id"`.
--
-- The function is shared by the goals and goal_kpis triggers and picked the
-- goal id with `case when tg_table_name = 'goals' then r.id else r.goal_id end`.
-- PL/pgSQL resolves every field reference in an expression against the row's
-- type, including the branch that isn't taken, so on a goals row (which has no
-- goal_id column) the trigger raised. That broke creating, editing and
-- deleting goals, including creating a board together with a new goal.
--
-- Reading the fields through jsonb leaves no static field reference, so the
-- same function works for both tables. The triggers already point at it.

create or replace function public.goals_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record := coalesce(new, old);
begin
  perform realtime.send(
    jsonb_build_object(
      'kind', tg_table_name,
      'op', tg_op,
      'goal_id', case when tg_table_name = 'goals'
                      then to_jsonb(r)->>'id'
                      else to_jsonb(r)->>'goal_id' end
    ),
    'changed', 'goals', true
  );
  return null;
end;
$$;
