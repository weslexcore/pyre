import type {
  MenuCategory,
  MenuSheetData,
  MenuSheetFeature,
  MenuSheetItem,
  MenuSheetOffer,
} from './types.ts';

export function renderMenuSheet(data: MenuSheetData, root: HTMLElement): void {
  const children: HTMLElement[] = [buildHeader(data.eyebrow, data.heading)];
  if (data.feature) children.push(buildFeature(data.feature));
  children.push(buildCategories(data.categories));
  if (data.footnote) children.push(buildFootnote(data.footnote));
  children.push(buildPineMark());

  root.classList.toggle('tpl-menu-sheet--featured', Boolean(data.feature));
  root.replaceChildren(...children);
}

function buildHeader(eyebrow: string | undefined, heading: string): HTMLElement {
  const header = document.createElement('header');
  header.className = 'tpl-menu-sheet__header';

  if (eyebrow) {
    const eb = document.createElement('span');
    eb.className = 'tpl-menu-sheet__eyebrow';
    eb.textContent = eyebrow;
    header.append(eb);
  }

  const h1 = document.createElement('h1');
  h1.className = 'tpl-menu-sheet__heading';
  h1.textContent = heading;

  header.append(h1);
  return header;
}

function buildCategories(categories: MenuCategory[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'tpl-menu-sheet__categories';
  for (const category of categories) wrap.append(buildCategory(category));
  return wrap;
}

function buildCategory(category: MenuCategory): HTMLElement {
  const section = document.createElement('section');
  section.className = 'tpl-menu-sheet__category';

  const title = document.createElement('h2');
  title.className = 'tpl-menu-sheet__category-title';
  title.textContent = category.title;

  section.append(title);

  if (category.note) {
    const note = document.createElement('p');
    note.className = 'tpl-menu-sheet__category-note';
    note.textContent = category.note;
    section.append(note);
  }

  const list = document.createElement('ul');
  list.className = 'tpl-menu-sheet__items';
  for (const item of category.items) list.append(buildItem(item));

  section.append(list);
  return section;
}

/* Dark full-width spotlight: label, name + price, a two-column perk list, and an
   optional nested offer callout. */
function buildFeature(feature: MenuSheetFeature): HTMLElement {
  const section = document.createElement('section');
  section.className = 'tpl-menu-sheet__feature';

  const label = document.createElement('span');
  label.className = 'tpl-menu-sheet__feature-label';
  label.textContent = feature.label;

  const row = document.createElement('div');
  row.className = 'tpl-menu-sheet__feature-row';
  const name = document.createElement('h2');
  name.className = 'tpl-menu-sheet__feature-name';
  name.textContent = feature.name;
  const price = document.createElement('span');
  price.className = 'tpl-menu-sheet__feature-price';
  price.textContent = feature.price;
  row.append(name, price);

  const perks = document.createElement('ul');
  perks.className = 'tpl-menu-sheet__perks';
  for (const perk of feature.perks) {
    const li = document.createElement('li');
    li.className = 'tpl-menu-sheet__perk';
    li.textContent = perk;
    perks.append(li);
  }

  section.append(label, row, perks);
  if (feature.offer) section.append(buildOffer(feature.offer));
  return section;
}

function buildOffer(offer: MenuSheetOffer): HTMLElement {
  const box = document.createElement('div');
  box.className = 'tpl-menu-sheet__offer';

  const label = document.createElement('span');
  label.className = 'tpl-menu-sheet__offer-label';
  label.textContent = offer.label;

  const row = document.createElement('div');
  row.className = 'tpl-menu-sheet__offer-row';
  const name = document.createElement('span');
  name.className = 'tpl-menu-sheet__offer-name';
  name.textContent = offer.name;
  const price = document.createElement('span');
  price.className = 'tpl-menu-sheet__offer-price';
  price.textContent = offer.price;
  row.append(name, price);

  box.append(label, row);

  if (offer.description) {
    const p = document.createElement('p');
    p.className = 'tpl-menu-sheet__offer-description';
    p.textContent = offer.description;
    box.append(p);
  }

  return box;
}

function buildItem(item: MenuSheetItem): HTMLElement {
  const li = document.createElement('li');
  li.className = 'tpl-menu-sheet__item';

  const row = document.createElement('div');
  row.className = 'tpl-menu-sheet__row';

  const name = document.createElement('span');
  name.className = 'tpl-menu-sheet__name';
  name.textContent = item.name;

  const price = document.createElement('span');
  price.className = 'tpl-menu-sheet__price';
  if (item.originalPrice) {
    const was = document.createElement('s');
    was.className = 'tpl-menu-sheet__price-was';
    was.textContent = item.originalPrice;
    price.append(was, document.createTextNode(item.price));
  } else {
    price.textContent = item.price;
  }

  row.append(name, price);
  li.append(row);

  if (item.note) {
    const note = document.createElement('p');
    note.className = 'tpl-menu-sheet__note';
    note.textContent = item.note;
    li.append(note);
  }

  if (item.chips?.length) {
    const chips = document.createElement('ul');
    chips.className = 'tpl-menu-sheet__chips';
    for (const chip of item.chips) {
      const c = document.createElement('li');
      c.className = 'tpl-menu-sheet__chip';
      c.textContent = chip;
      chips.append(c);
    }
    li.append(chips);
  }

  if (item.description) {
    const p = document.createElement('p');
    p.className = 'tpl-menu-sheet__description';
    if (item.highlighted) p.classList.add('tpl-menu-sheet__description--accent');
    p.textContent = item.description;
    li.append(p);
  }

  return li;
}

/* Full-width fine print (credit validity, sharing terms) above the pine mark. */
function buildFootnote(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'tpl-menu-sheet__footnote';
  p.textContent = text;
  return p;
}

/* Single centered pine-tree logo in place of a text footer
   (shared/textures/single-pine-tree.png). */
function buildPineMark(): HTMLElement {
  const mark = document.createElement('div');
  mark.className = 'tpl-menu-sheet__pine';
  mark.setAttribute('role', 'presentation');
  return mark;
}
