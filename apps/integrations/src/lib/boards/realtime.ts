// The Realtime side of boards and goals (see the live_notes_boards_checkins
// migration). A board's cards and card activity broadcast on `board:<slug>`
// for whoever may view that board; every card change also goes to
// `boards:all`, with board changes, for the all-tasks and calendar pages;
// goals, KPIs and goal activity go to `goals`. Islands refetch on a message.
//
// A card drawer's activity feed sits inside whichever island opened it and
// has no channel of its own, so an island that hears a change also raises
// BOARD_LIVE_EVENT on the document, which the feed listens for.
// Client-bundle-safe.

export const BOARDS_ALL_TOPIC = 'boards:all';
export const GOALS_TOPIC = 'goals';
export const BOARD_LIVE_EVENT = 'admin:board-live';

export function boardTopic(slug: string): string {
  return `board:${slug}`;
}

/** Tell any open activity feed that something on a board changed. */
export function announceBoardChange(): void {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent(BOARD_LIVE_EVENT));
}
