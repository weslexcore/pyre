# 0002 — Font assets 404 on GitHub Pages and preload warnings

## 1) Bug overview / description
- **Symptoms**:
  - 404s for font requests like `/_astro/fonts/PPFraktionMono-Bold.woff2` and `/_astro/fonts/PPNeueMontreal-Regular.woff2`.
  - Preload warnings: fonts at `/pyre/fonts/...` preloaded but not used.
- **Where**: Deployed site on GitHub Pages at project base `/pyre/`.

## 2) Root cause analysis
- `src/styles/global.css` defines `@font-face` sources using `url(fonts/...)` (no `./` and no site base), which resolves relative to the built CSS in `/_astro/`, yielding requests to `/_astro/fonts/...` that do not exist.
- Preloads in `src/layouts/main.astro` correctly use `${base}fonts/...` (e.g., `/pyre/fonts/...`), so the preloaded URLs do not match what CSS later requests, triggering "preloaded but not used" warnings.
- `astro.config.mjs` sets a non-root `base` (`/pyre/`), which requires base-aware asset URLs.

## 3) Impact assessment
- **Affected**: All users on the deployed site.
- **Features**: Site typography falls back to system fonts; brand typography not applied.
- **Data**: None.
- **UX**: Visual inconsistency and layout shifts due to missing webfonts; console errors.

## 4) Technical solution approach
- Make font URLs in CSS base-aware and consistent with preloads.
  - Option A (CSS var, preferred): Use the existing `--asset-base` set on `<html>` to construct URLs in `@font-face`.
    - Update `src/styles/global.css`:
      - Replace `url(fonts/PPNeueMontreal-Regular.woff2)` with `url(var(--asset-base)fonts/PPNeueMontreal-Regular.woff2)` and similarly for `.woff` and other faces.
      - Do the same for `PPNeueMontreal-SemiBold` and `PPFraktionMono-Bold`.
  - Option B (explicit base): Hardcode `url(/pyre/fonts/...)` only if the site base is guaranteed to remain `/pyre/`.
- Ensure `@font-face` family names match what is used in `:root --font-sans`/`--font-mono` to avoid unused preloads.
- Keep preloads in `src/layouts/main.astro` as `${base}fonts/...` and ensure they point to the exact same files referenced by CSS.

## 5) Testing strategy
- Local build: `yarn build && yarn preview` with `PUBLIC_ASTRO_BASE=/pyre/` to mimic GitHub Pages base; verify network panel shows 200s for `/pyre/fonts/*.woff2` and no requests to `/_astro/fonts/...`.
- Verify no console preload warnings and that computed styles use custom font families.
- Deploy to GitHub Pages and re-check:
  - All font requests load from `/pyre/fonts/...` with 200.
  - No "preloaded but not used" warnings.
- Cross-browser sanity: Chrome, Safari, Firefox for CSS var support inside `url()`.


