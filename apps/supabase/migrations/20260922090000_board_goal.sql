-- Boards carry their goal.
--
-- The goals and boards tools shipped as two pages joined only by
-- board_cards.goal_id. They are now one tool, organised around boards: a
-- board is the unit of work, and the goal it serves — judged by its KPIs —
-- sits on the board itself. Every card on a board is filed under the
-- board's goal (the routes set board_cards.goal_id from boards.goal_id on
-- create, and re-file the cards when a board's goal changes), so the goal's
-- task bar counts the board's cards without a picker on every card.
--
-- A board may have no goal: the general Tasks board is a to-do list, not a
-- target. A goal may serve one board; nothing stops two boards pointing at
-- the same goal, but the UI offers only goals no board holds yet.

alter table public.boards
  add column goal_id uuid references public.goals (id) on delete set null;

comment on column public.boards.goal_id is
  'The goal this board serves, judged by its KPIs. Every card on the board is filed under it. Null for a board that is just a list.';

create index boards_goal_id_idx on public.boards (goal_id);

-- Sub-goals have no UI since the merge: a goal is reached from its board,
-- and boards do not nest. The column stays so nothing written under the old
-- model is lost; the routes no longer accept or set it.
comment on column public.goals.parent_id is
  'Retained from the goals page; unused since goals moved onto boards. Always null for goals created since.';
