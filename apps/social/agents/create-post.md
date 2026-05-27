# Skill: create a new single-frame post

**Use this when:** the user wants one still image, one frame, no carousel, no video. If the output is an MP4 → also read `video-post.md`. If it's a carousel (2–10 slides) → read `multi-page-post.md` instead.

## Steps

1. **Pick a slug.** Kebab-case, descriptive, no date prefix needed unless the post is event-tied. Examples: `solstice-social`, `cold-plunge-womens-health`, `2026-06-21-solstice`.
2. **Create the folder.** `posts/<post-slug>/` with these three files (and optionally `assets/`).
3. **Decide template vs. bespoke.** List `templates/` — if one fits, link its CSS and copy the markup snippet. If nothing fits and the layout won't be reused, write bespoke markup directly in `index.html`. (Promote to a template later only if the same layout shows up in a second post — see `add-template.md`.)
4. **Run dev preview while iterating.** `yarn workspace @pyre/social dev` → `http://localhost:5173/preview/` → pick the post in the dropdown. HMR is on; CSS changes show instantly.
5. **Export when done.** `yarn workspace @pyre/social render <post-slug>` → files in `exports/<post-slug>/`.

## File scaffolds

### `posts/<post-slug>/index.html`

Minimum viable single-page post. Link tags must be in this order so cascade resolution works correctly:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title><post title> — Pyre</title>
    <link rel="stylesheet" href="/shared/reset.css" />
    <link rel="stylesheet" href="/shared/brand.css" />
    <!-- Optional: <link rel="stylesheet" href="/shared/tailwind.css" /> -->
    <!-- Optional: <link rel="stylesheet" href="/templates/<template>/template.css" /> -->
    <link rel="stylesheet" href="/shared/pages.css" />
    <link rel="stylesheet" href="./style.css" />
    <script type="module" src="/shared/pages.js"></script>
  </head>
  <body>
    <section class="page" data-page="1">
      <!-- post markup goes here -->
    </section>
  </body>
</html>
```

The `<section class="page" data-page="1">` wrapper is **required** even for single-frame posts — `shared/pages.css` hides every page that isn't `is-active`, and `shared/pages.js` activates page 1 by default.

### `posts/<post-slug>/style.css`

Start empty; add only post-specific overrides. Reference brand tokens, not raw hex:

```css
.post {
  width: 100vw;
  height: 100vh;
  background: var(--pyre-creme);
  color: var(--pyre-black);
  padding: var(--space-8);
}
```

### `posts/<post-slug>/post.config.ts`

Declare which sizes/formats to export. At least one entry required.

```ts
import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: '<post-slug>',
  exports: [
    { size: 'square', format: 'png' },
    { size: 'portrait', format: 'png' },
  ],
});
```

`name` must match the folder name. Available `size` values: `square | portrait | landscape | reel | story`. Available `format` values: `png | jpg | mp4`.

## Shared visual assets

- **Logo** — `/shared/logos/pyre_logo.svg`. Drop it in the footer of every post (see any reference post for the `<img class="footer__logo">` pattern). Recolor with `filter: brightness(0) invert(1)` on dark backgrounds.
- **Dividers** — `/shared/dividers/<color>/divider-<shape>.svg`. Use whenever a slide has a list, stats block, or quote that would otherwise call for a plain `border-top` rule. Eleven colors (`black`, `blue`, `blue-red`, `creme`, `gold`, `muted-gold`, `rainbow`, `red`, `red-gold`, `sage`, `sky`) × five shapes (`blob`, `squiggle`, `torn`, `wave`, `zigzag`). Match the divider color to the slide's accent. Each SVG is `1200×60`; the standard pattern is a `::before` pseudo-element with `background-size: 100% 100%` — see `posts/cold-plunge-for-beginners/style.css` (`.stats::before`, `.tips::before`, `.stat-line::before`).

## Brand tokens cheat sheet

Available everywhere `/shared/brand.css` is linked (which is every post):

```
--pyre-red    #d15232    --font-sans     PPNeueMontreal
--pyre-blue   #274868    --font-mono     PPNeueMontrealMono
--pyre-gold   #dbb155    --font-display  PPFraktionMono
--pyre-sage   #839770    --font-logo     Eckmannpsych
--pyre-sky    #3991b7
--pyre-black  #23221c
--pyre-creme  #f5f1e9

--space-1: 8px    --space-6: 48px
--space-2: 16px   --space-8: 64px
--space-3: 24px   --space-12: 96px
--space-4: 32px   --space-16: 128px
```

## Tailwind (optional)

Link `/shared/tailwind.css` if the post leans on utility classes. Tailwind's Preflight is off (`reset.css` handles it), and brand tokens are registered as utilities:

- Colors: `bg-pyre-red`, `text-pyre-blue`, `border-pyre-gold`, etc.
- Fonts: `font-sans`, `font-mono`, `font-display`, `font-logo`.

Tailwind sits in the cascade *before* `template.css` and `style.css`. To override a template style with a Tailwind utility, append `!` (e.g. `bg-pyre-red!`).

## Sizes — pick the right ones

| Key | Pixels | Ratio | Surface |
| --- | --- | --- | --- |
| `square` | 1080 × 1080 | 1:1 | Feed |
| `portrait` | 1080 × 1350 | 4:5 | Feed (most real-estate) |
| `landscape` | 1080 × 566 | 1.91:1 | Feed |
| `reel` | 1080 × 1920 | 9:16 | Reels |
| `story` | 1080 × 1920 | 9:16 | Stories |

A typical single-image post exports `square` + `portrait`. If you need a single PNG to span both feed and reel/story, also export `reel` (or `story`).

## Designing for multiple sizes

The artboard fills the viewport (`width: 100vw; height: 100vh`). The viewport is whatever the export size is — so the *same HTML* renders at three different aspect ratios. Two strategies:

- **Fluid layout** — flex/grid that adapts. Best when the design tolerates it.
- **Size-specific assets** — three differently-cropped hero images, shown/hidden by aspect-ratio media queries. See `posts/cold-plunge-womens-health/index.html` and its `style.css` for the working pattern (`.hero--square`, `.hero--portrait`, `.hero--reel`).

## Gotchas

- **Absolute vs relative paths.** Shared assets: `/shared/...`. Post-local assets: `./assets/...`. The dev preview will silently 404 if you mix these up — open DevTools Network if something doesn't appear.
- **Open in the preview shell, not the post URL directly.** `http://localhost:5173/preview/` is the multi-viewport shell. `http://localhost:5173/posts/<slug>/index.html` works for spot-checking one size, but the shell is what you should iterate in.
- **Page section is mandatory.** Without `<section class="page" data-page="1">…</section>` and the `pages.js` script, the body renders as `display: none` and you get a blank PNG.
- **Fonts in fallback.** If the export PNG shows the system fallback instead of the brand font, the font failed to load before screenshot. Check `/shared/fonts/` for the file, and check the dev preview first — if it's wrong there, it'll be wrong in the export.
