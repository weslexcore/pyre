import type { GiftCardData } from './types.ts';

const DEFAULT_LEDE = 'Heat, cold, connection.';

/**
 * Render two `<section class="page">`s per card (front, then back) into `root`, numbered from 1,
 * so a batch exports as paired PNGs ready for double-sided printing: card N is pages 2N-1 (front)
 * and 2N (back). Set `pages` in post.config.ts to `cards.length * 2`.
 */
export function renderGiftCards(cards: GiftCardData[], root: HTMLElement): void {
  root.replaceChildren(
    ...cards.flatMap((card, i) => [
      wrapPage(buildFront(card), i * 2 + 1),
      wrapPage(buildBack(card), i * 2 + 2),
    ])
  );
  // pages.js may have already run against an empty body; re-apply the active page.
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** "$50" for numbers (cents only when needed); strings print as given. */
export function formatValue(value: GiftCardData['value']): string {
  if (typeof value !== 'number') return value;
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

function wrapPage(content: HTMLElement, pageNumber: number): HTMLElement {
  const page = document.createElement('section');
  page.className = 'page';
  page.dataset.page = String(pageNumber);
  page.append(content);
  return page;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* Front: the same black brand face used on the voucher cards. */
function buildFront(card: GiftCardData): HTMLElement {
  const article = el('article', 'tpl-gift-card tpl-gift-card--front post');
  if (card.accent) article.dataset.accent = card.accent;

  const tagline = el('p', 'tpl-gift-card__tagline');
  tagline.append('Sauna ', el('span', 'tpl-gift-card__plus', '+'), ' Cold Plunge');

  article.append(
    el('h1', 'tpl-gift-card__wordmark', 'Pyre'),
    tagline,
    el('span', 'tpl-gift-card__cite', 'pyresauna.com · @pyre_sauna')
  );
  return article;
}

/* Back: eyebrow + logo, the value as the hero, then the code chip pinned to the bottom. */
function buildBack(card: GiftCardData): HTMLElement {
  const article = el('article', 'tpl-gift-card tpl-gift-card--back post');
  if (card.accent) article.dataset.accent = card.accent;

  const header = el('header', 'tpl-gift-card__header');
  const logo = el('img', 'tpl-gift-card__logo');
  logo.src = '/shared/logos/pyre_logo.svg';
  logo.alt = 'Pyre';
  header.append(el('span', 'tpl-gift-card__eyebrow', 'Gift card'), logo);

  const value = el('h1', 'tpl-gift-card__value', formatValue(card.value));
  const lede = el('p', 'tpl-gift-card__lede', card.lede ?? DEFAULT_LEDE);

  const children: HTMLElement[] = [header, value, lede];

  const names = buildNames(card);
  if (names) children.push(names);

  const footer = el('div', 'tpl-gift-card__footer');
  const chip = el('p', 'tpl-gift-card__code');
  chip.append('code: ', el('strong', 'tpl-gift-card__code-value', card.code));
  if (card.expires) chip.append(el('span', 'tpl-gift-card__expiry', card.expires));
  const redeem = el('span', 'tpl-gift-card__redeem');
  redeem.append('Enter the code at checkout', document.createElement('br'), 'pyresauna.com');
  footer.append(chip, redeem);
  children.push(footer);

  article.append(...children);
  return article;
}

function buildNames(card: GiftCardData): HTMLElement | null {
  const parts: string[] = [];
  if (card.to) parts.push(`For ${card.to}`);
  if (card.from) parts.push(`From ${card.from}`);
  if (parts.length === 0) return null;
  return el('p', 'tpl-gift-card__names', parts.join(' · '));
}
