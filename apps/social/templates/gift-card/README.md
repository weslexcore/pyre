# Template: gift-card

A double-sided 3.5×2in print gift card (size key `business-card`, 1125×675px with bleed). The
front is the black Pyre brand face used on the voucher cards. The back carries the card's
**value** as the hero, a one-line lede, optional "For / From" names, and the redemption **code**
in a ticket-style chip. Each card renders as two pages (front, then back), so a batch exports as
paired PNGs ready for double-sided printing.

Fill in a code and a value per card in a typed data file; the template does the rest.

## Usage

1. Link the template stylesheet in your post's `index.html`:

   ```html
   <link rel="stylesheet" href="/shared/reset.css" />
   <link rel="stylesheet" href="/shared/brand.css" />
   <link rel="stylesheet" href="/shared/pages.css" />
   <link rel="stylesheet" href="/templates/gift-card/template.css" />
   <link rel="stylesheet" href="./style.css" />
   <script type="module" src="/shared/pages.js"></script>
   ```

2. Leave `<body>` as the mount point and render the cards into it:

   ```html
   <body>
     <script type="module">
       import { renderGiftCards } from '/templates/gift-card/template.ts';
       import { cards } from './cards.data.ts';

       renderGiftCards(cards, document.body);
     </script>
   </body>
   ```

3. Define the cards in a data file next to the post. `code` and `value` are the only required
   fields:

   ```ts
   import type { GiftCardData } from '../../templates/gift-card/types.ts';

   export const cards: GiftCardData[] = [
     { code: 'PYRE-7K2M-Q9', value: 50 },
     { code: 'PYRE-3XD8-LA', value: 100, to: 'Sam', from: 'Alex' },
     { code: 'PYRE-H4PT-2N', value: '4 credits', expires: 'use by 12/31/2027' },
   ];
   ```

4. In `post.config.ts`, export at `business-card` and set `pages` to two per card:

   ```ts
   import { cards } from './cards.data.ts';

   export default defineConfig({
     name: 'gift-card',
     pages: cards.length * 2,
     exports: [{ size: 'business-card', format: 'png', filename: 'gift-card' }],
   });
   ```

   Card N exports as `gift-card-<2N-1>.png` (front) and `gift-card-<2N>.png` (back); the first
   card's front is plain `gift-card.png`.

## Data fields

| Field | Required | Prints as |
| --- | --- | --- |
| `code` | yes | Verbatim, in the code chip: `code: PYRE-7K2M-Q9` |
| `value` | yes | A number becomes a dollar amount (`50` → `$50`, `12.5` → `$12.50`); a string prints as-is (`'4 credits'`) |
| `lede` | no | One line under the value. Default: `Heat, cold, connection.` |
| `to` / `from` | no | `For Sam · From Alex` in mono caps under the lede |
| `expires` | no | Small line inside the code chip, e.g. `use by 12/31/2027` |
| `accent` | no | Set as `data-accent` on both faces for per-batch recoloring |

## Slots

| Class | Purpose |
| --- | --- |
| `.tpl-gift-card` | Card root; `--front` / `--back` modifiers pick the face |
| `.tpl-gift-card__wordmark` | Front: the Pyre wordmark |
| `.tpl-gift-card__tagline` | Front: `Sauna + Cold Plunge` |
| `.tpl-gift-card__cite` | Front: site and handle |
| `.tpl-gift-card__eyebrow` | Back: `Gift card` label, top left |
| `.tpl-gift-card__logo` | Back: pine logo, top right |
| `.tpl-gift-card__value` | Back: the amount, display type |
| `.tpl-gift-card__lede` | Back: one-line description |
| `.tpl-gift-card__names` | Back: optional For / From line |
| `.tpl-gift-card__code` | Back: ticket chip holding the code and optional expiry |
| `.tpl-gift-card__redeem` | Back: redemption note, bottom right |

Set `--tpl-gift-card-accent` on `.tpl-gift-card[data-accent="…"]` in your post's `style.css` to
recolor the eyebrow and code per batch (default: Pyre red).
