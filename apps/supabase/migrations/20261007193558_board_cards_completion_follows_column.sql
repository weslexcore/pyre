-- Put every card's completion stamp back in step with the column it sits in.
--
-- A card is finished because its column's kind says so (done or dropped);
-- completed_at / completed_by are the stamp that follows, and the strike-
-- through, the open/total tallies, Up next, and Recently done all read the
-- stamp. Until now only a move (or a card filed straight into a finished
-- column) set or cleared it. Changing a column's own kind in board settings
-- left the cards already in it behind: an open column turned into Done kept
-- its cards reading as open, and a Done column turned open kept its cards
-- struck through. The route now carries the cards along on a kind change
-- (lib/boards/cards kindChangePatch); this repairs the cards it missed.

-- Cards sitting in a done or dropped column with no stamp: finished.
-- updated_at (the old value, read before the set_updated_at trigger bumps
-- it) is the best record of when that happened, so the card lands in the
-- right week of Recently done rather than all at once today. Whoever last
-- touched the card is credited, else whoever made it, as the
-- board_cards_completion_attributed check requires someone. A finished card
-- waits on nobody, the same as a move into a finished column.
update public.board_cards as card
set
  completed_at = card.updated_at,
  completed_by = coalesce(card.updated_by, card.created_by),
  waiting_on = null
from public.board_columns as col
where col.id = card.column_id
  and col.kind in ('done', 'dropped')
  and card.completed_at is null;

-- Cards sitting in an open column that still carry a stamp: open again.
update public.board_cards as card
set
  completed_at = null,
  completed_by = null
from public.board_columns as col
where col.id = card.column_id
  and col.kind = 'open'
  and card.completed_at is not null;
