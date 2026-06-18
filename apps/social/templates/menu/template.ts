import type { MenuData, MenuItem } from './types.ts';

export function renderMenu(data: MenuData, root: HTMLElement): void {
  root.replaceChildren(
    buildHeader(data.eyebrow, data.heading),
    buildItems(data.items),
    buildFooter(data.footer.address)
  );
}

function buildHeader(eyebrow: string, heading: string): HTMLElement {
  const header = document.createElement('header');
  header.className = 'tpl-menu__header';

  const eb = document.createElement('span');
  eb.className = 'tpl-menu__eyebrow';
  eb.textContent = eyebrow;

  const h1 = document.createElement('h1');
  h1.className = 'tpl-menu__heading';
  h1.textContent = heading;

  header.append(eb, h1);
  return header;
}

function buildItems(items: MenuItem[]): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'tpl-menu__items';
  for (const item of items) list.append(buildItem(item));
  return list;
}

function buildItem(item: MenuItem): HTMLElement {
  const li = document.createElement('li');
  li.className = 'tpl-menu__item';

  const row = document.createElement('div');
  row.className = 'tpl-menu__row';

  const name = document.createElement('span');
  name.className = 'tpl-menu__name';
  name.textContent = item.name;

  const price = document.createElement('span');
  price.className = 'tpl-menu__price';
  if (item.originalPrice) {
    const was = document.createElement('s');
    was.className = 'tpl-menu__price-was';
    was.textContent = item.originalPrice;
    price.append(was, document.createTextNode(item.price));
  } else {
    price.textContent = item.price;
  }

  row.append(name, price);
  li.append(row);

  if (item.chips?.length) {
    const chips = document.createElement('ul');
    chips.className = 'tpl-menu__chips';
    for (const chip of item.chips) {
      const c = document.createElement('li');
      c.className = 'tpl-menu__chip';
      c.textContent = chip;
      chips.append(c);
    }
    li.append(chips);
  }

  if (item.description) {
    const p = document.createElement('p');
    p.className = 'tpl-menu__description';
    if (item.highlighted) p.classList.add('tpl-menu__description--accent');
    p.textContent = item.description;
    li.append(p);
  }

  return li;
}

function buildFooter(address: string): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'tpl-menu__footer';

  const brandMark = document.createElement('div');
  brandMark.className = 'tpl-menu__brand-mark';

  const img = document.createElement('img');
  img.src = '/shared/logos/pyre_logo.svg';
  img.width = 28;
  img.height = 28;
  img.alt = '';

  const brand = document.createElement('span');
  brand.className = 'tpl-menu__brand';
  brand.textContent = 'PYRE';

  brandMark.append(img, brand);

  const addr = document.createElement('span');
  addr.textContent = address;

  footer.append(brandMark, addr);
  return footer;
}
