### Description
Fonts 404 on GitHub Pages because `@font-face` in `src/styles/global.css` uses `url(fonts/...)`, which resolves relative to built CSS in `/_astro/`, producing bad requests like `/_astro/fonts/*.woff2`. Meanwhile, the layout preloads fonts from `${base}fonts/...` (e.g., `/pyre/fonts/...`), causing “preloaded but not used” warnings due to mismatch.

### Root cause analysis
- Non-root `base` is configured in `astro.config.mjs` via `PUBLIC_ASTRO_BASE` (defaults to `/pyre/`).
- `@font-face` `src:` uses `url(fonts/...)` without a base, so requests go to `/_astro/fonts/...` and 404.
- `src/layouts/main.astro` preloads correct URLs using `import.meta.env.BASE_URL` (`base`) and sets `--asset-base` on `<html>`, but CSS does not use it for font URLs.

### Technical approach
- Make font URLs base-aware and match preload URLs.
  - Preferred: use global CSS variable `--asset-base` already defined in `src/layouts/main.astro`.
  - Keep font files in `public/fonts/*` to continue serving from `${base}fonts/...`.

### Files to update
- `src/styles/global.css`
  - In each `@font-face` block, change:
    - `url(fonts/PPNeueMontreal-Regular.woff2)` → `url(var(--asset-base)fonts/PPNeueMontreal-Regular.woff2)`
    - `url(fonts/PPNeueMontreal-Regular.woff)` → `url(var(--asset-base)fonts/PPNeueMontreal-Regular.woff)`
    - `url(fonts/PPNeueMontreal-SemiBold.woff2)` → `url(var(--asset-base)fonts/PPNeueMontreal-SemiBold.woff2)`
    - `url(fonts/PPNeueMontreal-SemiBold.woff)` → `url(var(--asset-base)fonts/PPNeueMontreal-SemiBold.woff)`
    - `url(fonts/PPFraktionMono-Bold.woff2)` → `url(var(--asset-base)fonts/PPFraktionMono-Bold.woff2)`
    - `url(fonts/PPFraktionMono-Bold.woff)` → `url(var(--asset-base)fonts/PPFraktionMono-Bold.woff)`
- Verify only (no edit expected):
  - `src/layouts/main.astro`: continues to define `const base = import.meta.env.BASE_URL ?? '/'` and set `<html style={"--asset-base: ${base}"}>`, and preloads:
    - `${base}fonts/PPNeueMontreal-SemiBold.woff2`
    - `${base}fonts/PPNeueMontreal-Regular.woff2`
  - `src/lib/fonts.ts`: family names align with `@font-face` (`PPNeueMontreal-Regular`, `PPNeueMontreal-SemiBold`, `PPFraktionMono-Bold`).

### Step-by-step
1) Update `src/styles/global.css` font URLs to use `var(--asset-base)` as above.
2) Build locally with a non-root base to mimic GitHub Pages:
   - `PUBLIC_ASTRO_BASE=/pyre/ yarn build && yarn preview`
3) Verify in browser:
   - Network: 200s for `/pyre/fonts/*.woff2` and no requests to `/_astro/fonts/...`.
   - Console: no “preloaded but not used” warnings; computed fonts reflect custom families.
4) Deploy and re-check in production (GitHub Pages) with the same verifications.

### Notes
- If any browser fails to resolve CSS variable inside `url(...)`, fallback is to hardcode `url(/pyre/fonts/...)` only if the site base will remain `/pyre/`. Prefer the variable approach for portability.

