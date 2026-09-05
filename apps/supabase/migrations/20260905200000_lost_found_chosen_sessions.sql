-- Which sessions staff picked when they logged the item.
--
-- The log form asks "which sessions could this have been left in?" instead of
-- asking for clock times, so the choice is made once, at the desk, by whoever
-- found the thing and knows which class had just let out. The item page then
-- opens with those sessions already selected and the send button stating how
-- many people that is — the send is still a deliberate second act, but staff
-- don't answer the same question twice.
--
-- Momence session ids, so text rather than uuid, and empty for items logged
-- with a known owner or while Momence was unreachable. left_window_start and
-- left_window_end still span the choice: the notify route re-derives who is
-- eligible from the window alone, so nothing here widens who can be emailed.

alter table public.lost_found_items
  add column if not exists chosen_session_ids text[] not null default '{}';
