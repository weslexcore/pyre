// Opening a card where the person already is. Every link to a card is
// /admin/boards/<slug>#card-<id> (lib/boards/calendar cardHref), so a click
// on one anywhere in admin is turned into these window events instead of a
// trip to the board (CardPeek.tsx):
//
//   * OPEN_CARD_EVENT is cancelable. A page that already holds the card —
//     its board, the all-tasks list, the calendar — opens its own drawer and
//     cancels it (useCardDeepLink), so the edit lands in that page's state.
//     Nobody claiming it means the peek fetches the card's board and opens
//     the drawer over whatever page this is.
//   * CARD_CHANGED_EVENT fires when the peek closes after a save or delete,
//     so a page showing the same card reloads what it shows.

import { isBoardSlug } from '@/lib/boards/types';

export const OPEN_CARD_EVENT = 'admin:open-card';
export const CARD_CHANGED_EVENT = 'admin:card-changed';

export interface CardTarget {
  slug: string;
  id: string;
}

const BOARD_PATH_RE = /^\/admin\/boards\/([^/]+)\/?$/;
const CARD_HASH_RE = /^#card-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The card a same-origin link opens, or null when it is not a card link. */
export function cardTargetOf(href: string, origin: string): CardTarget | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const slug = BOARD_PATH_RE.exec(url.pathname)?.[1];
  const id = CARD_HASH_RE.exec(url.hash)?.[1];
  if (!slug || !id || !isBoardSlug(slug)) return null;
  return { slug, id };
}
