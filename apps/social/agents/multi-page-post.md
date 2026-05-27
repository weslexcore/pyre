# Skill: multi-page carousel post

**Use this when:** the user wants a carousel of 2–10 slides (Instagram's carousel maximum is 10). If you haven't already, read `create-post.md` first — this skill describes only the **diffs** vs a single-page post.

## What changes vs a single-page post

| | Single-page | Multi-page |
| --- | --- | --- |
| `post.config.ts` | no `pages` field | add `pages: N` (positive integer) |
| `index.html` | one `<section class="page" data-page="1">` | N stacked sections, `data-page="1" … "N"` |
| `exports/<slug>/` | `square-1.png` | `square-1.png`, `square-2.png`, … `square-N.png` |
| Same `exports[]` list | applies to one page | applies to **every** page automatically |

## How rendering works

Each page is rendered by navigating to `…/posts/<slug>/index.html#page=<N>` and re-loading. `shared/pages.js` reads the hash, then toggles `.is-active` onto the matching `<section.page>`. Every other page is `display: none` via `shared/pages.css`.

**This means CSS animations restart fresh at every page boundary.** Don't try to chain an animation across pages — each export is an independent render.

## `post.config.ts`

```ts
import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: '<post-slug>',
  pages: 3,
  exports: [
    { size: 'square', format: 'png' },
    { size: 'portrait', format: 'png' },
  ],
});
```

Output: `square-1.png`, `square-2.png`, `square-3.png`, `portrait-1.png`, … six files total.

`pages` must be a positive integer (validated in `scripts/lib/config.ts`).

## `index.html`

Stack N sections in the `<body>`. Each gets its own `data-page` value:

```html
<body>
  <section class="page" data-page="1">
    <!-- slide 1 markup -->
  </section>
  <section class="page" data-page="2">
    <!-- slide 2 markup -->
  </section>
  <section class="page" data-page="3">
    <!-- slide 3 markup -->
  </section>
</body>
```

If slides share most markup (e.g. same hero, different headline), it's fine to duplicate — the file is human-edited, and explicit beats clever. See `posts/cold-plunge-womens-health/index.html` for a working two-page reference.

## Previewing

- The preview shell (`http://localhost:5173/preview/`) stacks every page vertically under each size/format card, so you see all slides at all sizes at once.
- To inspect one page in isolation, navigate the browser directly to `http://localhost:5173/posts/<slug>/index.html#page=2`.

## Custom output filenames

To override the `<size>` portion of the output filename, set `filename` on the export entry. The `-<page>` suffix still appends:

```ts
exports: [
  { size: 'square', format: 'png', filename: 'feed' },
  // → exports/<slug>/feed-1.png, feed-2.png, feed-3.png
];
```

## Visual rhythm across slides

Carousels lean on dividers more than single-frame posts — they break up dense slides (stats, tips, quotes) and let each slide carry its own accent color.

- Pull dividers from `/shared/dividers/<color>/divider-<shape>.svg` (eleven colors × five shapes; see `AGENTS.md` for the full list).
- Match the divider color to the slide's accent (sky-themed slide → `sky/`, gold accent → `gold/`).
- Vary the shape across the carousel for rhythm — see `posts/cold-plunge-for-beginners/` for a working example that uses `gold/divider-wave.svg`, `sky/divider-squiggle.svg`, and `gold/divider-zigzag.svg` on three different slides.

## Gotchas

- **Wrong `pages` count.** If `pages: 3` but only two `<section class="page">` exist, page 3 renders as a blank canvas. Conversely, extra sections beyond `pages` are never rendered.
- **Mismatched `data-page` values.** `data-page="1"`, `"2"`, `"3"` — sequential, starting from 1. `pages.js` matches on exact string equality with the hash value.
- **One settle per page.** `settleMs` (if set) applies to every page render, since each one is a fresh navigation.
