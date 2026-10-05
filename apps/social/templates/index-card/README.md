# Template: index-card

A 5×3" landscape print card (size key `index-card`, 1575×975px with bleed). Mono eyebrow and pine
logo across the top, a big title and one-line lede, then a ruled ledger of rows (label, value and
an optional pill tag), closed by a small footnote. Each card renders as its own page, so a deck of
cards exports as one PNG per card.

Built for the essential-oil blend cards (`posts/essential-oil-blends/`), but any short
recipe-style card fits: ingredient lists, house rules, a ritual's steps.

## Usage

1. Link the template stylesheet in your post's `index.html`:

   ```html
   <link rel="stylesheet" href="/shared/reset.css" />
   <link rel="stylesheet" href="/shared/brand.css" />
   <link rel="stylesheet" href="/shared/pages.css" />
   <link rel="stylesheet" href="/templates/index-card/template.css" />
   <link rel="stylesheet" href="./style.css" />
   <script type="module" src="/shared/pages.js"></script>
   ```

2. Leave `<body>` as the mount point and render your cards into it:

   ```html
   <body>
     <script type="module">
       import { renderIndexCards } from '/templates/index-card/template.ts';
       import { cards } from './cards.data.ts';

       renderIndexCards(cards, document.body);
     </script>
   </body>
   ```

3. Define the cards in a typed data file next to the post:

   ```ts
   import type { IndexCardData } from '../../templates/index-card/types.ts';

   export const cards: IndexCardData[] = [
     {
       eyebrow: 'Uplifting · 01',
       title: 'Wake Up',
       lede: 'Invigorating, mental clarity',
       rows: [{ label: 'Lemon', value: '3 drops', tag: 'Top' }],
       footnote: '3 drops total',
       accent: 'uplifting',
     },
   ];
   ```

4. In `post.config.ts`, set `pages` to the number of cards and export at `index-card`:

   ```ts
   exports: [{ size: 'index-card', format: 'png' }],
   pages: 9,
   ```

## Slots

| Class | Purpose | Data field |
| --- | --- | --- |
| `.tpl-index-card` | Card root; carries `data-accent` for per-group color | `accent` |
| `.tpl-index-card__eyebrow` | Red mono label, top left | `eyebrow` |
| `.tpl-index-card__logo` | Pine logo, top right (fixed) | — |
| `.tpl-index-card__title` | Large uppercase title | `title` |
| `.tpl-index-card__lede` | One-line description (optional) | `lede` |
| `.tpl-index-card__row` | Ledger row: label, value, tag | `rows[]` |
| `.tpl-index-card__tag` | Pill at row end; carries `data-tag` (lowercased) | `rows[].tag` |
| `.tpl-index-card__footer` | Mono fine print under the ledger (optional) | `footnote` |

Set `--tpl-index-card-accent` on `.tpl-index-card[data-accent="…"]` in your post's `style.css` to
recolor the eyebrow per group.
