import { useEffect, useRef } from 'react';

const PREFIX = '#card-';

/**
 * Arriving from a notification, search, or a shared link: #card-<id> names the
 * card to open once the cards have loaded. The link is spent on that first
 * load — the hash is cleared with replaceState, so a refresh lands on the
 * page rather than reopening the drawer, and later reloads of the data
 * (every save sets it again) don't reopen a card the person closed.
 */
export function useCardDeepLink(
  cards: readonly { id: string }[] | undefined,
  open: (id: string) => void
) {
  const handled = useRef(false);

  useEffect(() => {
    if (!cards || handled.current) return;
    handled.current = true;
    const hash = window.location.hash;
    if (!hash.startsWith(PREFIX)) return;
    const id = hash.slice(PREFIX.length);
    if (cards.some((card) => card.id === id)) open(id);
    const url = new URL(window.location.href);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
  }, [cards, open]);
}
