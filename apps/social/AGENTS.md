# AGENTS.md — apps/social/

This directory is a small authoring tool for Instagram posts. Posts are plain HTML/CSS files served by Vite; final PNG/MP4 output is rendered by Playwright (plus ffmpeg for video). You author in `posts/<post-slug>/` and export to `exports/<post-slug>/`.

If you're an agent, **start here**: identify the task below, then read the one matching skill file in `agents/`. Don't read all of them — load only what you need.

**Before writing any copy**, read [`agents/brand-voice.md`](agents/brand-voice.md). It owns voice, archetype, recurring phrases, and rewrite examples. For business facts (location, offerings, pricing, contacts) and visual cues, read [`agents/business-details.md`](agents/business-details.md).

## Pick your task

| If the user wants to… | Open |
| --- | --- |
| Make a new IG post (single image, single frame) | [`agents/create-post.md`](agents/create-post.md) |
| Make a carousel / multi-slide post (2–10 slides) | [`agents/multi-page-post.md`](agents/multi-page-post.md) |
| Make a reel / video / animated post (MP4 output) | [`agents/video-post.md`](agents/video-post.md) |
| Extract a recurring layout into a reusable template | [`agents/add-template.md`](agents/add-template.md) |
| Export an existing post, or debug a render failure | [`agents/export-and-troubleshoot.md`](agents/export-and-troubleshoot.md) |

A "create a new IG post that's also a reel" request needs **two** skills — read `create-post.md` for the structure, then `video-post.md` for the MP4 export details.

## Hard rules

These are the constraints that, if broken, make the post fail to render or look wrong. Read them once before opening a skill file.

- **Folder contract.** Every post folder must contain `index.html`, `style.css`, and `post.config.ts`. No exceptions. Drop static assets (images, video, audio) under `posts/<post-slug>/assets/`.
- **Pixel artboard.** The canvas is 1080px wide. Use absolute pixel sizes (`font-size: 96px`, `padding: 64px`) — not `rem`, not `em`-based layout. The brand defines an 8px spacing scale (`--space-1` … `--space-16`); prefer those tokens.
- **Sizes are an enum.** `square | portrait | landscape | reel | story | small-menu | postcard-4x6 | letter`. See `scripts/lib/sizes.ts` for dimensions. Don't invent a new key — extend that file if a new size is genuinely needed, and mirror the inline `SIZES` map in `preview/index.html`.
- **Brand tokens, not hex.** Colors and fonts live in `shared/brand.css` (`--pyre-red`, `--font-display`, etc.) and are mirrored as Tailwind tokens in `shared/tailwind.css` (`bg-pyre-red`, `font-display`). Don't re-declare `@font-face` or hard-code a brand color.
- **Photo grading.** For a consistent feel across posts, link `/shared/photo-filters.css` and apply a brand-anchored look (`.photo--warm-sauna`, `.photo--cold-plunge`, `.photo--sage-still`, `.photo--noir`, `.photo--ember`) to the hero `<img>`. Filters compose with `.overlay--*` gradients — they don't replace them.
- **Serve through Vite.** The dev server (`yarn workspace @pyre/social dev`) is the only correct preview path. Opening `posts/<slug>/index.html` directly in a browser breaks because Vite is what resolves `/shared/*` and `/templates/*` absolute paths.
- **Page sections are mandatory.** Every renderable frame is wrapped in `<section class="page" data-page="N">…</section>`. Even a single-frame post needs `<section class="page" data-page="1">`, because `shared/pages.css` hides every page that isn't `is-active`.
- **Don't commit `exports/`.** It's gitignored. Only commit source files under `posts/<post-slug>/`.
- **Asset paths.** Reference shared assets with absolute paths (`/shared/logos/pyre_logo.svg`, `/shared/dividers/<color>/divider-<shape>.svg`). Reference post-local assets with relative paths (`./assets/hero.webp`).
- **Shared visual assets.** Use these over re-inventing chrome:
  - **Logo** — `/shared/logos/pyre_logo.svg`. Lives in every post footer (see any reference post). Sized at `width="30" height="30"` or `height: 56px` in CSS; recolor with `filter: brightness(0) invert(1)` on dark backgrounds.
  - **Dividers** — `/shared/dividers/<color>/divider-<shape>.svg`. Reach for one whenever a slide has a list, stats block, or quote and you'd otherwise be drawing a plain `border-top` line. Colors: `black | blue | blue-red | creme | gold | muted-gold | rainbow | red | red-gold | sage | sky`. Shapes: `blob | squiggle | torn | wave | zigzag`. PNG fallbacks sit next to the SVGs. Match the divider color to the page accent (sky page → `sky/`, gold accent → `gold/`). Each SVG is `1200×60`; apply as a `background` on a `::before` pseudo-element with `background-size: 100% 100%` (slight vertical stretch is fine — the shapes are stylized).

## Standard workflow

Every authoring task follows the same loop:

1. **Author** — edit files under `posts/<post-slug>/`.
2. **Preview** — `yarn workspace @pyre/social dev` → open `http://localhost:5173/preview/`, select the post. The shell shows every configured size side-by-side with HMR.
3. **Iterate** — adjust CSS until each size reads cleanly.
4. **Export** — `yarn workspace @pyre/social render <post-slug>` → files land in `exports/<post-slug>/`.

The skill files assume you'll run this loop; they tell you what's specific to each task type.

## When you need more context

These are the source-of-truth files. Open them only if the skill file points you there.

- `agents/brand-voice.md` — voice, archetype, recurring phrases, rewrite examples. Read before drafting any copy.
- `agents/business-details.md` — about the business: facts, offerings, visual cues. Read before writing copy.
- `README.md` — the human-facing tutorial. Comprehensive but linear.
- `scripts/lib/config.ts` — canonical `PostConfig` schema (TypeScript types).
- `scripts/lib/sizes.ts` — every size key and its `{w, h}` dimensions.
- `shared/brand.css` — color and font tokens, plus the 8px spacing scale.
- `shared/tailwind.css` — Tailwind v4 theme tokens (brand colors as utilities).
- `shared/logos/` — `pyre_logo.svg` (the only logo). Footer chrome on every post.
- `shared/dividers/<color>/` — 11 brand-colored sets (`black`, `blue`, `blue-red`, `creme`, `gold`, `muted-gold`, `rainbow`, `red`, `red-gold`, `sage`, `sky`), 5 shapes each (`blob`, `squiggle`, `torn`, `wave`, `zigzag`) as both SVG and PNG. Use to break up stats lists, tip lists, and quote blocks — see `posts/cold-plunge-for-beginners/style.css` for the `::before` pseudo-element pattern.
- `templates/<name>/README.md` — slot reference for each template.
- `posts/example-summer-launch/` — minimal single-page reference post.
- `posts/cold-plunge-womens-health/` — multi-page reference post with hero images and CSS animations.
