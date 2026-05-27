# Skill: export a post, or debug a render failure

**Use this when:** the user wants to run `render` on an existing post, or something about the render is broken (errors, wrong output, blank PNG, jumpy MP4).

## Commands

All run from anywhere in the monorepo:

```bash
# Render one post, all sizes/formats declared in its post.config.ts
yarn workspace @pyre/social render <post-slug>

# Render one post, only one size
yarn workspace @pyre/social render <post-slug> --size square

# Render every post in posts/
yarn workspace @pyre/social render:all
```

The render script spins up its own Vite server on port **5174** (so it doesn't collide with the dev server on 5173). You don't need `yarn dev` running.

## Output layout

```
exports/<post-slug>/
├── square-1.png                    # size-page.ext
├── square-2.png                    # (for multi-page posts)
├── portrait-1.png
├── reel-1.mp4
├── reel-2.mp4
└── <post-slug>-reel.mp4            # joined reel (only when pages > 1)
```

Filenames follow `<size>-<page>.<ext>`. Override the `<size>` portion with `filename: 'custom'` on an export entry — the `-<page>` suffix still appends (`custom-1.png`, `custom-2.png`).

For multi-page MP4 exports, the renderer also produces a single joined file `<post-slug>-<size>.mp4` (or `<post-slug>-<filename>.mp4` if `filename` is set). This is the file you upload to Instagram as the reel; the per-page files are kept for re-rendering individual pages.

`exports/` is gitignored. Don't commit it.

## Reading the error

The script prints one line per file as it renders:

```
Rendering example-summer-launch
  → square (png) page 1/1  ./exports/example-summer-launch/square-1.png
  → portrait (png) page 1/1  ./exports/example-summer-launch/portrait-1.png
  → reel (mp4) page 1/1  ./exports/example-summer-launch/reel-1.mp4
```

If it fails mid-list, the error trace points at the failing entry. Common error texts and fixes below.

## Common failures

### `No post.config.ts found at …`

The post slug doesn't match any folder in `posts/`. Run `ls posts/` to confirm the slug, or check that `posts/<post-slug>/post.config.ts` exists.

### `post.config.ts at … must default-export a config object`

The config file is missing the default export. Fix:

```ts
import { defineConfig } from '../../scripts/lib/config.ts';
export default defineConfig({ name: '…', exports: [ … ] });
```

### `post.config.ts at …: pages must be a positive integer`

`pages` is set to `0`, a float, or a non-number. Use a positive integer (`1`, `2`, … `10`).

### Blank / empty PNG

Every renderable frame must live inside `<section class="page" data-page="N">…</section>`, and `shared/pages.js` must be loaded. Checklist:
- `<script type="module" src="/shared/pages.js"></script>` in `<head>`.
- `<link rel="stylesheet" href="/shared/pages.css" />` in `<head>`.
- At least one `<section class="page" data-page="1">…</section>` in `<body>`.
- For multi-page posts, `data-page` values are `"1"` through `"N"` (strings, sequential).

### Fonts render as the system fallback

The font file failed to load before the screenshot fired. Check:
- `/shared/fonts/<name>.woff2` exists.
- The dev preview (`yarn workspace @pyre/social dev`) shows the correct font — if it's wrong there, fix it before re-rendering.
- For MP4, `document.fonts.ready` is awaited before recording starts, so this shouldn't happen unless the file is genuinely missing.

### MP4 starts mid-animation / blurry first frame

Recording started before the entrance animation finished. Two fixes:
- Set `settleMs: <ms>` on the post config to skip past the entrance.
- Or restructure the animation so the at-rest state *is* the first frame (no entrance — let it just be there).

See `agents/video-post.md` for the full pattern.

### MP4 loop seam is visible

The first frame and last frame don't match. Use `animation-direction: alternate` so the animation reverses cleanly, or design `0%` and `100%` keyframes to be visually identical.

### Render hangs

- Stale Playwright temp state. Delete `apps/social/.playwright-temp/` and retry.
- Port 5174 in use. Kill anything holding it (`lsof -i :5174`).
- Chromium not installed: `yarn workspace @pyre/social playwright install chromium`.

### `Error: browserType.launch: Executable doesn't exist`

Chromium isn't installed for Playwright. One-time setup:

```bash
yarn workspace @pyre/social playwright install chromium
```

### Filenames you didn't expect

- `<size>-<page>.<ext>` is the default. If you set `filename: 'feed'` on an export, the output is `feed-1.png` (still page-suffixed).
- The `<page>` suffix is always present even for single-page posts — by design, so multi-page output stays consistent.

## When to re-render

After any of these, re-render the affected post:

- Edit to `posts/<slug>/index.html` or `style.css` or `post.config.ts`.
- Edit to a template the post links (`templates/<name>/template.css`).
- Edit to anything in `shared/` (affects every post).

`render:all` is the safe nuclear option after a `shared/` edit.
