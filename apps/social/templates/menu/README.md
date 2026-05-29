# Template: menu

A single-category menu layout: eyebrow + section heading at the top, a list of name/price rows with optional flavor chips or descriptions underneath, brand footer at the bottom. Adapts to square, portrait, and reel crops via aspect-ratio media queries.

Built for drinks first, but the same shape works for snacks, merch, or any other priced list — change the heading and items.

## Usage

The menu is data-driven. Define your items in a typed `menu.data.ts` next to your post and mount it with a small entry script. The HTML stays a fixed shell — to update the menu, edit the data file.

1. In your post's `index.html`, link the template stylesheet alongside the shared brand stylesheets:

   ```html
   <link rel="stylesheet" href="/shared/reset.css" />
   <link rel="stylesheet" href="/shared/brand.css" />
   <link rel="stylesheet" href="/templates/menu/template.css" />
   <link rel="stylesheet" href="./style.css" />
   ```

2. Put an empty mount point in your `<body>` and call `renderMenu` with your data:

   ```html
   <section class="page" data-page="1">
     <section class="tpl-menu post"></section>
   </section>
   <script type="module">
     import { menu } from './menu.data.ts';
     import { renderMenu } from '/templates/menu/template.ts';
     renderMenu(menu, document.querySelector('.tpl-menu'));
   </script>
   ```

3. Create `menu.data.ts` alongside the post:

   ```ts
   import type { MenuData } from '../../templates/menu/types.ts';

   export const menu: MenuData = {
     eyebrow: 'Menu · 2026',
     heading: 'Drinks',
     items: [
       { name: 'LMNT Electrolyte', price: '$2.50', chips: ['Grapefruit', 'Watermelon'] },
       { name: 'Dram CBD · Sweetgrass', price: '$5', description: 'Earthy sweetgrass with vanilla, mint…' },
     ],
     footer: { address: '1000 Westover Hills Blvd.' },
   };
   ```

4. Each item can have `chips` (pill-style variants) **or** `description` (a one-line note) — both are optional, and both can be omitted entirely for a bare name/price row.

5. Override anything you want in the post's own `style.css` (background color, heading font, etc.). See `template.html` for the DOM structure the renderer produces.

## Slots

| Class | Purpose | Data field |
| --- | --- | --- |
| `.tpl-menu__eyebrow` | Small uppercase label above the heading | `eyebrow` |
| `.tpl-menu__heading` | Section title ("Drinks", "Snacks", "Merch") | `heading` |
| `.tpl-menu__name` | Item name | `items[].name` |
| `.tpl-menu__price` | Item price, right-aligned on the same line as the name | `items[].price` |
| `.tpl-menu__chips` / `.tpl-menu__chip` | Wrapping list of variants for the item (optional) | `items[].chips` |
| `.tpl-menu__description` | Short tasting note under the name (optional) | `items[].description` |
| `.tpl-menu__brand` | Footer wordmark (fixed: "PYRE") | — |
| `.tpl-menu__footer span` (last) | Footer address | `footer.address` |
