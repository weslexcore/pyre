# @pyre/social

Author Instagram posts in plain HTML/CSS, preview them at every Instagram aspect ratio simultaneously, then render to PNG and MP4 with one command.

## Setup

From the monorepo root:

```bash
nvm use            # Node 22 LTS
corepack enable
yarn install
yarn workspace @pyre/social playwright install chromium
```

## Two commands

```bash
# 1. Live preview at all configured sizes, with hot reload
yarn workspace @pyre/social dev
#    → http://localhost:5173/preview/

# 2. Export the post to exports/<post>/
yarn workspace @pyre/social render example-summer-launch
yarn workspace @pyre/social render example-summer-launch --size square   # just one size
yarn workspace @pyre/social render:all                                    # every post in posts/
```

## Directory layout

```
apps/social/
├── posts/                          # One folder per post
│   └── <post-name>/
│       ├── index.html              # Markup
│       ├── style.css               # Post-specific styles
│       ├── post.config.ts          # Which sizes/formats to export
│       └── assets/                 # Local images, video, audio
├── templates/                      # Reusable HTML + CSS pairs
│   └── <template-name>/
│       ├── template.html
│       ├── template.css
│       └── README.md
├── shared/                         # Brand assets (every post inherits)
│   ├── brand.css                   # Color + font CSS variables, @font-face
│   ├── reset.css
│   ├── pages.css                   # Visibility rule for multi-page posts
│   ├── pages.js                    # Reads #page=N hash, reveals matching <section.page>
│   ├── fonts/                      # PPNeueMontreal, PPFraktionMono, Eckmannpsych
│   └── logos/                      # Drop logos here, reference via /shared/logos/…
├── preview/index.html              # Dev preview shell (multi-viewport iframes)
├── scripts/                        # Render + dev tooling (TypeScript)
└── exports/                        # Generated PNG/MP4 (gitignored)
```

## Authoring a new post

1. Create a folder under `posts/`, e.g. `posts/2026-06-21-solstice/`.
2. Add `index.html` linking the shared and template stylesheets. Wrap every page of content in `<section class="page" data-page="N">…</section>`:

   ```html
   <!doctype html>
   <html>
     <head>
       <link rel="stylesheet" href="/shared/reset.css" />
       <link rel="stylesheet" href="/shared/brand.css" />
       <link rel="stylesheet" href="/shared/tailwind.css" />
       <link rel="stylesheet" href="/templates/product-card/template.css" />
       <link rel="stylesheet" href="/shared/pages.css" />
       <link rel="stylesheet" href="./style.css" />
       <script type="module" src="/shared/pages.js"></script>
     </head>
     <body>
       <section class="page" data-page="1">
         <!-- copy a template's snippet here, or write your own markup -->
       </section>
     </body>
   </html>
   ```
3. Add `style.css` for post-specific overrides.
4. Add `post.config.ts` declaring which sizes to export:

   ```ts
   import { defineConfig } from '../../scripts/lib/config.ts';

   export default defineConfig({
     name: '2026-06-21-solstice',
     exports: [
       { size: 'square',   format: 'png' },
       { size: 'portrait', format: 'png' },
       { size: 'reel',     format: 'mp4', duration: 6000 },
     ],
   });
   ```
5. `yarn workspace @pyre/social dev` → the preview shell renders all three viewports side-by-side with HMR.
6. `yarn workspace @pyre/social render 2026-06-21-solstice` → final files land in `exports/2026-06-21-solstice/`.

## Sizes

| Key | Pixels | Ratio | Instagram surface |
| --- | --- | --- | --- |
| `square` | 1080 × 1080 | 1:1 | Feed |
| `portrait` | 1080 × 1350 | 4:5 | Feed (max real-estate) |
| `landscape` | 1080 × 566 | 1.91:1 | Feed |
| `reel` | 1080 × 1920 | 9:16 | Reels |
| `story` | 1080 × 1920 | 9:16 | Stories |

## Multi-page posts

Instagram carousels can hold up to 10 slides. To author a multi-page post, add a top-level `pages: N` field to `post.config.ts` and stack N `<section class="page" data-page="N">…</section>` blocks in `index.html`:

```ts
export default defineConfig({
  name: '2026-06-21-solstice',
  pages: 3,
  exports: [
    { size: 'square',   format: 'png' },
    { size: 'portrait', format: 'png' },
  ],
});
```

```html
<body>
  <section class="page" data-page="1">…</section>
  <section class="page" data-page="2">…</section>
  <section class="page" data-page="3">…</section>
</body>
```

The same export list applies to every page, so a 3-page square post produces `square-1.png`, `square-2.png`, `square-3.png` (see [Notes](#notes)).

The preview shell stacks every page vertically under each size/format card. To view a single page directly in your browser, visit `…/posts/<name>/index.html#page=2`. Pure CSS animations restart fresh each time a page is loaded (the renderer navigates anew per page).

## Brand tokens

Every post automatically has these CSS variables available (defined in `shared/brand.css`):

```css
--pyre-red    #d15232    --font-sans     PPNeueMontreal
--pyre-blue   #274868    --font-mono     PPNeueMontrealMono
--pyre-gold   #dbb155    --font-display  PPFraktionMono
--pyre-sage   #839770    --font-logo     Eckmannpsych
--pyre-sky    #3991b7
--pyre-black  #23221c
--pyre-creme  #f5f1e9
```

## Tailwind

Tailwind v4 is wired in via `@tailwindcss/vite`. Linking `/shared/tailwind.css`
in a post gives you the full utility set plus brand-aware tokens registered in
`@theme`:

```html
<h1 class="font-display text-pyre-red">Sweat out the longest day.</h1>
<div class="bg-pyre-creme p-12 rounded-2xl">…</div>
```

Available brand-scoped utilities:

- Colors: `pyre-red`, `pyre-blue`, `pyre-gold`, `pyre-sage`, `pyre-sky`, `pyre-black`, `pyre-creme` (use with `bg-`, `text-`, `border-`, etc.)
- Fonts: `font-sans`, `font-mono`, `font-display`, `font-logo`

Tailwind's Preflight is intentionally disabled — `shared/reset.css` already
handles the artboard-specific reset (full-bleed `html`/`body`, font smoothing,
geometric text rendering). To add new tokens, edit the `@theme` block in
`shared/tailwind.css`.

Templates and post-specific `style.css` files load *after* Tailwind, so plain
CSS in those files wins over utilities by default; append `!` to a utility
(e.g. `bg-pyre-red!`) when you need it to override template styles.

## Templates

A template is just a folder under `templates/` with a `template.html` snippet, a `template.css` file, and a README documenting which class names act as slots. Posts use a template by `<link>`-ing its CSS and copying its HTML structure into their `<body>`. See `templates/product-card/` for a working example.

## How video export works

Videos are recorded by Playwright while loading the post in a headless Chromium tab sized to the target resolution. The raw `.webm` is transcoded to H.264 MP4 (`yuv420p`, 30 fps, faststart) so the file uploads cleanly to Instagram. CSS animations and `<video>` elements both play during recording — design accordingly.

For long animations, set `duration` (ms) on the export entry to the wall-clock length you want captured. The default is 5000 ms.

## Notes

- Posts are plain HTML files served by Vite, so you can use ES modules, image imports, and `<video>` exactly as in any Vite site.
- Output filenames are `<size>-<page>.<ext>` (e.g. `square-1.png`). Override the `<size>` portion with `filename: 'custom-name'` on an export entry — the `-<page>` suffix still stacks (`custom-name-1.png`, `custom-name-2.png`).
- The `exports/` directory is gitignored — commit only source files.
