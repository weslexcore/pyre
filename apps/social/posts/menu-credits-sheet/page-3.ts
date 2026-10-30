import type {
  MenuCategory,
  MenuSheetData,
  MenuSheetFeature,
  MenuSheetItem,
  MenuSheetOffer,
} from '../../templates/menu-sheet/types.ts';

/* Page 3: loud editorial poster. Founding Unlimited set as type that spans the page, perks as a
   mono list beside a giant price, the intro offer as a tear-off ticket, and credit packs
   and subscriptions demoted to a fine-print table at the foot. */
export function renderPage3(data: MenuSheetData, root: HTMLElement): void {
  const children: HTMLElement[] = [];
  if (data.feature) {
    children.push(buildMasthead(data.feature));
    children.push(buildHero(data.feature));
    children.push(buildPriceAndPerks(data.feature));
    if (data.feature.offer) children.push(buildTicket(data.feature.offer));
  }
  children.push(buildFinePrint(data.categories, data.footnote));
  root.replaceChildren(...children);

  // Fit the hero word to the full measure once the display font is in.
  void document.fonts.ready.then(() => {
    for (const el of root.querySelectorAll<HTMLElement>('[data-fit]')) fitToWidth(el);
  });
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

/* Scale font-size so the element's text exactly fills its parent's content width. */
function fitToWidth(node: HTMLElement): void {
  const parent = node.parentElement;
  if (!parent) return;
  const target = parent.clientWidth;
  const size = Number.parseFloat(getComputedStyle(node).fontSize);
  const width = node.scrollWidth;
  if (width > 0) node.style.fontSize = `${(size * target) / width}px`;
}

function buildMasthead(feature: MenuSheetFeature): HTMLElement {
  const bar = el('header', 'alt-page-3__masthead');
  const logo = el('img', 'alt-page-3__logo');
  logo.src = '/shared/logos/pyre_logo.svg';
  logo.alt = 'Pyre';
  bar.append(logo, el('span', 'alt-page-3__label', feature.label));
  if (feature.badge) bar.append(el('span', 'alt-page-3__badge', feature.badge));
  return bar;
}

/* The membership name: every word but the last as a lead-in line, the last word fit to the page. */
function buildHero(feature: MenuSheetFeature): HTMLElement {
  const hero = el('section', 'alt-page-3__hero');
  const words = feature.name.trim().split(/\s+/);
  const last = words.pop() ?? feature.name;
  if (words.length) hero.append(el('p', 'alt-page-3__lead', words.join(' ')));
  const big = el('h1', 'alt-page-3__word', last);
  big.dataset.fit = '';
  hero.append(big);
  return hero;
}

function buildPriceAndPerks(feature: MenuSheetFeature): HTMLElement {
  const grid = el('section', 'alt-page-3__grid');

  const priceCol = el('div', 'alt-page-3__price-col');
  const slash = feature.price.indexOf('/');
  const amount = slash === -1 ? feature.price : feature.price.slice(0, slash);
  const per = slash === -1 ? '' : feature.price.slice(slash);
  const price = el('p', 'alt-page-3__price');
  price.append(el('span', 'alt-page-3__price-amount', amount));
  if (per) price.append(el('span', 'alt-page-3__price-per', per));
  priceCol.append(el('p', 'alt-page-3__col-label', 'Price'), price);

  const perksCol = el('div', 'alt-page-3__perks-col');
  perksCol.append(el('p', 'alt-page-3__col-label', 'What it includes'));
  const list = el('ul', 'alt-page-3__perks');
  for (const perk of feature.perks) list.append(el('li', 'alt-page-3__perk', perk));
  perksCol.append(list);

  grid.append(priceCol, perksCol);
  return grid;
}

/* Tear-off coupon: a big price stub, a dashed perforation, and the offer details. */
function buildTicket(offer: MenuSheetOffer): HTMLElement {
  const ticket = el('section', 'alt-page-3__ticket');

  const stub = el('div', 'alt-page-3__stub');
  stub.append(
    el('span', 'alt-page-3__stub-label', offer.label),
    el('span', 'alt-page-3__stub-price', offer.price)
  );

  const body = el('div', 'alt-page-3__ticket-body');
  body.append(el('h2', 'alt-page-3__ticket-name', offer.name));
  if (offer.description) body.append(el('p', 'alt-page-3__ticket-desc', offer.description));

  ticket.append(stub, el('div', 'alt-page-3__perforation'), body);
  return ticket;
}

function buildFinePrint(categories: MenuCategory[], footnote: string | undefined): HTMLElement {
  const wrap = el('footer', 'alt-page-3__fine');
  const tables = el('div', 'alt-page-3__tables');
  for (const category of categories) tables.append(buildCategory(category));
  wrap.append(tables);
  if (footnote) wrap.append(el('p', 'alt-page-3__footnote', footnote));
  return wrap;
}

function buildCategory(category: MenuCategory): HTMLElement {
  const section = el('section', 'alt-page-3__category');
  const head = el('div', 'alt-page-3__category-head');
  head.append(el('h3', 'alt-page-3__category-title', category.title));
  if (category.note) head.append(el('span', 'alt-page-3__category-note', category.note));
  section.append(head);

  const rows = el('ul', 'alt-page-3__rows');
  for (const item of category.items) rows.append(buildRow(item));
  section.append(rows);
  return section;
}

function buildRow(item: MenuSheetItem): HTMLElement {
  const row = el('li', 'alt-page-3__row');
  const main = el('div', 'alt-page-3__row-main');
  main.append(el('span', 'alt-page-3__row-name', item.name));
  const prices = el('span', 'alt-page-3__row-prices');
  if (item.originalPrice) prices.append(el('s', 'alt-page-3__row-was', item.originalPrice));
  prices.append(el('span', 'alt-page-3__row-price', item.price));
  main.append(prices);
  row.append(main);
  if (item.note) row.append(el('span', 'alt-page-3__row-note', item.note));
  return row;
}
