import type { MenuCategory, MenuItem, MenuSheetData } from './types.ts';

export function renderMenuSheet(data: MenuSheetData, root: HTMLElement): void {
  root.replaceChildren(
    buildHeader(data.eyebrow, data.heading),
    buildCategories(data.categories),
    buildPineMark()
  );
}

function buildHeader(eyebrow: string, heading: string): HTMLElement {
  const header = document.createElement('header');
  header.className = 'tpl-menu-sheet__header';

  const eb = document.createElement('span');
  eb.className = 'tpl-menu-sheet__eyebrow';
  eb.textContent = eyebrow;

  const h1 = document.createElement('h1');
  h1.className = 'tpl-menu-sheet__heading';
  h1.textContent = heading;

  header.append(eb, h1);
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

  const list = document.createElement('ul');
  list.className = 'tpl-menu-sheet__items';
  for (const item of category.items) list.append(buildItem(item));

  section.append(title, list);
  return section;
}

function buildItem(item: MenuItem): HTMLElement {
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

/* Single centered pine-tree logo in place of a text footer
   (shared/textures/single-pine-tree.png). */
function buildPineMark(): HTMLElement {
  const mark = document.createElement('div');
  mark.className = 'tpl-menu-sheet__pine';
  mark.setAttribute('role', 'presentation');
  return mark;
}
