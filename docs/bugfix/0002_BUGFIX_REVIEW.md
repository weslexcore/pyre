### Code Review – Bugfix 0002: Font URLs respect base path

#### Summary
- The plan to make font URLs base-aware is correctly implemented. The change should eliminate 404s to `/_astro/fonts/*` and resolve the “preloaded but not used” warnings by aligning CSS `@font-face` URLs with the layout preloads.

#### What was changed
- `src/styles/global.css`
  - `@font-face` `src:` entries now use `url(var(--asset-base)fonts/...)`, matching the configured base path.
- `src/layouts/main.astro`
  - Continues to compute `base` from `import.meta.env.BASE_URL` and sets it via `<html style="--asset-base: ${base}">`.
  - Preloads `PPNeueMontreal-SemiBold.woff2` and `PPNeueMontreal-Regular.woff2` from `${base}fonts/...`.
- `src/lib/fonts.ts`
  - Font family names (`PPNeueMontreal-Regular`, `PPNeueMontreal-SemiBold`, `PPFraktionMono-Bold`) align with the `@font-face` declarations.
- `astro.config.mjs`
  - `base` derives from `PUBLIC_ASTRO_BASE` (defaulting to `/pyre/`), consistent with the approach.

#### Correctness and risks
- Using `var(--asset-base)` in `url(...)` should work in modern browsers. If any browser exhibits issues with CSS variables inside `url()`, consider a targeted fallback (see below) after verification.
- Preload URLs and CSS font URLs now match, so the “preloaded but not used” warning should disappear.

#### Minor observations
- `src/lib/fonts.ts` utilities reference family names without weights in `calculateKerning` (e.g., `PPNeueMontreal`). This doesn’t break anything but differs from the actual family strings. Consider normalizing or removing the unused branch.
- Only the two primary sans fonts are preloaded. That’s fine for performance. If the mono font is used above-the-fold, consider preloading it as well.

#### Verification checklist
1) Local build with non-root base:
   - `PUBLIC_ASTRO_BASE=/pyre/ yarn build && yarn preview`
2) In the browser:
   - Network: 200s for `/pyre/fonts/*.woff2`, no `/_astro/fonts/...` requests.
   - Console: no “preloaded but not used” warnings.
   - Elements: computed fonts show the custom families.

#### Optional fallback (only if compatibility issues appear)
- If a specific browser fails to resolve `var(--asset-base)` in `@font-face` `url(...)`, you can temporarily hardcode the project base (e.g., `/pyre/`) or introduce a secondary `src` entry as a last resort. Prefer keeping the variable approach for portability.


