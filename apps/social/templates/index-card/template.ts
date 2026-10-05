import type { IndexCardData, IndexCardRow } from './types.ts';

/**
 * Render one `<section class="page">` per card into `root`, numbered from 1, so a deck of
 * cards exports as one PNG per page. Set `pages` in post.config.ts to `cards.length`.
 */
export function renderIndexCards(cards: IndexCardData[], root: HTMLElement): void {
  root.replaceChildren(
    ...cards.map((card, i) => {
      const page = document.createElement('section');
      page.className = 'page';
      page.dataset.page = String(i + 1);
      page.append(buildCard(card));
      return page;
    })
  );
  // pages.js may have already run against an empty body; re-apply the active page.
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

function buildCard(card: IndexCardData): HTMLElement {
  const article = document.createElement('article');
  article.className = 'tpl-index-card post';
  if (card.accent) article.dataset.accent = card.accent;

  const header = document.createElement('header');
  header.className = 'tpl-index-card__header';

  const eyebrow = document.createElement('span');
  eyebrow.className = 'tpl-index-card__eyebrow';
  eyebrow.textContent = card.eyebrow;

  const logo = document.createElement('img');
  logo.className = 'tpl-index-card__logo';
  logo.src = '/shared/logos/pyre_logo.svg';
  logo.alt = 'Pyre';

  header.append(eyebrow, logo);

  const title = document.createElement('h1');
  title.className = 'tpl-index-card__title';
  title.textContent = card.title;

  const children: HTMLElement[] = [header, title];

  if (card.lede) {
    const lede = document.createElement('p');
    lede.className = 'tpl-index-card__lede';
    lede.textContent = card.lede;
    children.push(lede);
  }

  const rows = document.createElement('ul');
  rows.className = 'tpl-index-card__rows';
  for (const row of card.rows) rows.append(buildRow(row));
  children.push(rows);

  if (card.footnote) {
    const footer = document.createElement('footer');
    footer.className = 'tpl-index-card__footer';
    footer.textContent = card.footnote;
    children.push(footer);
  }

  article.append(...children);
  return article;
}

function buildRow(row: IndexCardRow): HTMLElement {
  const li = document.createElement('li');
  li.className = 'tpl-index-card__row';

  const label = document.createElement('span');
  label.className = 'tpl-index-card__label';
  label.textContent = row.label;

  const value = document.createElement('span');
  value.className = 'tpl-index-card__value';
  value.textContent = row.value;

  li.append(label, value);

  if (row.tag) {
    const tag = document.createElement('span');
    tag.className = 'tpl-index-card__tag';
    tag.dataset.tag = row.tag.toLowerCase();
    tag.textContent = row.tag;
    li.append(tag);
  }

  return li;
}
