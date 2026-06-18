# Template: menu-sheet

A categorized, multi-column drink menu sized for an 8.5×11" print sheet. An eyebrow + section
heading at the top, then named categories (each with name/price rows and optional flavor chips
or descriptions) flowing across **two columns** (left column fills first), closed by a
single centered pine-tree logo at the bottom.

Built for a printable full-sheet drinks menu. The category-aware data shape and the
`renderMenuSheet` renderer are the difference from the IG-oriented [`menu`](../menu/README.md)
template — reuse that one for single-list social crops, this one for grouped print sheets.

## Usage

The menu is data-driven. Define your categories in a typed `menu.data.ts` next to your post and
mount it with a small entry script. The HTML stays a fixed shell — to update the menu, edit the
data file.

1. In your post's `index.html`, link the template stylesheet alongside the shared brand
   stylesheets:

   ```html
   <link rel="stylesheet" href="/shared/reset.css" />
   <link rel="stylesheet" href="/shared/brand.css" />
   <link rel="stylesheet" href="/templates/menu-sheet/template.css" />
   <link rel="stylesheet" href="./style.css" />
   ```

2. Put an empty mount point in your `<body>` and call `renderMenuSheet` with your data:

   ```html
   <section class="page" data-page="1">
     <section class="tpl-menu-sheet post"></section>
   </section>
   <script type="module">
     import { menu } from './menu.data.ts';
     import { renderMenuSheet } from '/templates/menu-sheet/template.ts';
     renderMenuSheet(menu, document.querySelector('.tpl-menu-sheet'));
   </script>
   ```

3. Create `menu.data.ts` alongside the post:

   ```ts
   import type { MenuSheetData } from '../../templates/menu-sheet/types.ts';

   export const menu: MenuSheetData = {
     eyebrow: 'Menu · 2026',
     heading: 'Drinks',
     categories: [
       {
         title: 'Electrolytes',
         items: [
           { name: 'LMNT Electrolyte Mix', price: '$2.50', chips: ['Grapefruit', 'Watermelon'] },
         ],
       },
       {
         title: 'Herbs + Adaptogens',
         items: [
           { name: 'Dram CBD', price: '$5', description: '25mg CBD + adaptogens' },
         ],
       },
     ],
   };
   ```

4. Each item can have `chips` (pill-style variants) **or** `description` (a one-line note) — both
   are optional, and both can be omitted for a bare name/price row. `MenuItem` / `MenuFooter` are
   re-exported from the [`menu`](../menu/types.ts) template.

5. Export at the `letter` size (8.5×11" @ 300dpi = 2550×3300) from your `post.config.ts`. The
   template scales type up for that canvas via a `@media (min-width: 2000px)` block.

## Slots

| Class | Purpose | Data field |
| --- | --- | --- |
| `.tpl-menu-sheet__eyebrow` | Small uppercase label above the heading | `eyebrow` |
| `.tpl-menu-sheet__heading` | Section title ("Drinks") | `heading` |
| `.tpl-menu-sheet__category-title` | Category name ("Electrolytes") | `categories[].title` |
| `.tpl-menu-sheet__name` | Item name | `categories[].items[].name` |
| `.tpl-menu-sheet__price` | Item price, right-aligned on the name's line | `categories[].items[].price` |
| `.tpl-menu-sheet__chips` / `.tpl-menu-sheet__chip` | Wrapping list of variants (optional) | `categories[].items[].chips` |
| `.tpl-menu-sheet__description` | Short note under the name (optional) | `categories[].items[].description` |
| `.tpl-menu-sheet__pine` | Single centered pine-tree logo at the bottom (fixed) | — |
