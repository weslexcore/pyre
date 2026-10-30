import type {
  MenuCategory,
  MenuSheetData,
  MenuSheetFeature,
  MenuSheetItem,
  MenuSheetOffer,
} from '../../templates/menu-sheet/types.ts';

/* Page 4: calm, centered "member card". The Founding Unlimited membership is drawn as a physical
   black card on sage, its perks sit in a quiet grid below, the intro offer is a creme tag, and the
   credit packs and subscriptions are fine print at the foot of the page. */
export function renderPage4(data: MenuSheetData, root: HTMLElement): void {
  const children: HTMLElement[] = [];
  const { feature } = data;

  if (feature) {
    children.push(buildCard(feature));
    children.push(buildPerks(feature.perks));
    if (feature.offer) children.push(buildOffer(feature.offer));
  }

  children.push(buildFinePrint(data.categories, data.footnote));
  root.replaceChildren(...children);
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* The card itself: logo + wordmark, a gold chip, the membership name and price, the pine mark,
   and the availability badge as a round gold sticker over the top-right corner. */
function buildCard(feature: MenuSheetFeature): HTMLElement {
  const stage = el('div', 'alt-page-4__stage');
  const card = el('div', 'alt-page-4__card');

  const top = el('div', 'alt-page-4__card-top');
  const brand = el('div', 'alt-page-4__brand');
  const logo = document.createElement('img');
  logo.className = 'alt-page-4__logo';
  logo.src = '/shared/logos/pyre_logo.svg';
  logo.alt = '';
  brand.append(logo, el('span', 'alt-page-4__wordmark', 'Pyre'));
  top.append(brand);

  const chip = el('div', 'alt-page-4__chip');

  const bottom = el('div', 'alt-page-4__card-bottom');
  const id = el('div', 'alt-page-4__card-id');
  id.append(
    el('p', 'alt-page-4__card-label', feature.label),
    el('h1', 'alt-page-4__name', feature.name),
    el('p', 'alt-page-4__price', feature.price)
  );
  bottom.append(id, el('div', 'alt-page-4__pine'));

  card.append(top, chip, bottom);
  stage.append(card);

  if (feature.badge) {
    const badge = el('div', 'alt-page-4__badge');
    badge.append(el('span', 'alt-page-4__badge-text', feature.badge));
    stage.append(badge);
  }

  return stage;
}

function buildPerks(perks: string[]): HTMLElement {
  const list = el('ul', 'alt-page-4__perks');
  for (const perk of perks) list.append(el('li', 'alt-page-4__perk', perk));
  return list;
}

/* Intro offer as a creme paper tag with a punched hole. */
function buildOffer(offer: MenuSheetOffer): HTMLElement {
  const tag = el('div', 'alt-page-4__tag');
  const body = el('div', 'alt-page-4__tag-body');

  const head = el('div', 'alt-page-4__tag-head');
  head.append(
    el('span', 'alt-page-4__tag-label', offer.label),
    el('span', 'alt-page-4__tag-name', offer.name)
  );

  body.append(head);
  if (offer.description) body.append(el('p', 'alt-page-4__tag-desc', offer.description));

  tag.append(
    el('span', 'alt-page-4__tag-hole'),
    body,
    el('span', 'alt-page-4__tag-price', offer.price)
  );
  return tag;
}

function buildFinePrint(categories: MenuCategory[], footnote: string | undefined): HTMLElement {
  const footer = el('footer', 'alt-page-4__fine');
  const cols = el('div', 'alt-page-4__cols');
  for (const category of categories) cols.append(buildCategory(category));
  footer.append(cols);
  if (footnote) footer.append(el('p', 'alt-page-4__footnote', footnote));
  return footer;
}

function buildCategory(category: MenuCategory): HTMLElement {
  const section = el('section', 'alt-page-4__cat');
  const head = el('div', 'alt-page-4__cat-head');
  head.append(el('h2', 'alt-page-4__cat-title', category.title));
  if (category.note) head.append(el('p', 'alt-page-4__cat-note', category.note));

  const list = el('ul', 'alt-page-4__items');
  for (const item of category.items) list.append(buildItem(item));

  section.append(head, list);
  return section;
}

function buildItem(item: MenuSheetItem): HTMLElement {
  const li = el('li', 'alt-page-4__item');
  const row = el('div', 'alt-page-4__item-row');
  const prices = el('span', 'alt-page-4__item-prices');
  if (item.originalPrice) prices.append(el('s', 'alt-page-4__item-was', item.originalPrice));
  prices.append(el('span', 'alt-page-4__item-price', item.price));
  row.append(
    el('span', 'alt-page-4__item-name', item.name),
    el('span', 'alt-page-4__item-dots'),
    prices
  );
  li.append(row);
  if (item.note) li.append(el('p', 'alt-page-4__item-note', item.note));
  return li;
}
