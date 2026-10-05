import { useEffect, useRef } from 'react';
import { CARD_CHANGED_EVENT, type CardTarget, OPEN_CARD_EVENT } from './cardPeekEvents';

const PREFIX = '#card-';

export interface CardDeepLinkOptions {
  /**
   * A drawer is already open here. A card link clicked inside it (a link
   * field's chip) is left to the peek, which stacks over it, rather than
   * swapping drawers out from under an edit still waiting to save.
   */
  drawerOpen?: boolean;
  /** Reload the page's cards after the peek saved one. */
  reload?: () => void;
}

/**
 * Arriving from a notification, search, or a shared link: #card-<id> names the
 * card to open once the cards have loaded. The link is spent on that first
 * load — the hash is cleared with replaceState, so a refresh lands on the
 * page rather than reopening the drawer, and later reloads of the data
 * (every save sets it again) don't reopen a card the person closed.
 *
 * A card link clicked while the page is up opens here too, when the card is
 * one this page holds (cardPeekEvents); anything else is the peek's.
 */
export function useCardDeepLink(
  cards: readonly { id: string }[] | undefined,
  open: (id: string) => void,
  options: CardDeepLinkOptions = {}
) {
  const handled = useRef(false);
  const latest = useRef({ cards, open, options });
  latest.current = { cards, open, options };

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

  useEffect(() => {
    const onOpen = (event: Event) => {
      const { id } = (event as CustomEvent<CardTarget>).detail;
      const { cards, open, options } = latest.current;
      if (options.drawerOpen || !cards?.some((card) => card.id === id)) return;
      event.preventDefault();
      open(id);
    };
    const onChanged = () => latest.current.options.reload?.();
    window.addEventListener(OPEN_CARD_EVENT, onOpen);
    window.addEventListener(CARD_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(OPEN_CARD_EVENT, onOpen);
      window.removeEventListener(CARD_CHANGED_EVENT, onChanged);
    };
  }, []);
}
