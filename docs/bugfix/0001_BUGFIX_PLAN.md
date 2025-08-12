### Description
Public images and symbols fail to load when the site is deployed under a non-root base (e.g., `/pyre`). Components reference absolute public paths like `/images/...`, `/symbols/...`, and `/logos/...` which bypass the configured base. Additionally, per request: also convert all `img` tags to use Astro's `Image` component for performance gains.

### Root cause analysis
- Components and inline styles hardcode absolute public asset paths that do not include the configured base.
  - Example hardcoded usages:
    - `src/components/StorySection.astro`: inline background `style="background-image: url(/images/sauna_ladle.jpeg)"`
    - `src/lib/*`: config data uses leading-slash paths (e.g., `/images/hero.png`, `/symbols/connection-symbol.png`), which must be made base-aware at render time
- `withBase` logic is duplicated per-component instead of centralized.
- CSS background images and fonts referenced from `public/` are not uniformly base-aware.
  - `src/styles/global.css`: `.bg-repeating-logo { background-image: url(logos/repeating_background.png); }` (not base-aware)
  - `@font-face` uses `url(fonts/...)`, which may not resolve under a subpath in production
- Several components still render `<img>` directly instead of `<Image>` from `astro:assets`.
  - Found `<img>` in: `Hero.astro`, `ExperiencesSection.astro`, `BreakSection.astro`, `Footer.astro`, `Navbar.astro`, `SignupForm.astro`

### Technical approach
- Base path handling
  - Create a small shared helper at `src/lib/paths.ts` exporting `withBase(path: string): string` that prefixes `import.meta.env.BASE_URL` to any leading‑slash path.
  - Remove duplicated `const base = import.meta.env.BASE_URL ?? '/'` and local `withBase` from components; import and use the shared helper everywhere public assets are referenced.
- Convert all `<img>` to Astro `<Image>`
  - Import `Image` from `astro:assets` in each component with `<img>` and replace usages with `<Image>`.
  - Keep existing `class`, `alt`, `loading`, `decoding`, and provide explicit `width`/`height` (use current intrinsic or reasonable approximations consistent with layout) to reduce CLS.
  - For sources that originate from config files as public paths (e.g., `/symbols/...`), pass them through `withBase(...)` before providing to `<Image src>`. If any asset fails optimization due to being a string path, treat as follow‑up to migrate those specific files into `src/assets` and import statically.
- CSS backgrounds
  - Make the repeating brand border base-aware:
    - Continue setting `--asset-base` on the root element in `src/layouts/main.astro` (already present).
    - Update `.bg-repeating-logo` in `src/styles/global.css` to build its `background-image` using the base variable (e.g., `url(var(--asset-base)logos/repeating_background.png)`), or alternatively set the background image inline where the class is used using the base-aware helper.
  - Replace hardcoded inline background in `src/components/StorySection.astro` with a base-aware URL (computed at render time with `withBase`) or switch to an absolutely positioned `<Image>` layer for the background with `object-cover`.
- Fonts
  - Migrate fonts from `public/fonts` to `src/assets/fonts` and update `@font-face` in `src/styles/global.css` to reference the assets via relative paths so the bundler rewrites URLs with the configured base.
  - Keep the existing `<link rel="preload" ...>` entries in `src/layouts/main.astro`, updating them if names or locations change.
- Social/metadata assets
  - `src/layouts/main.astro` already computes favicon and social image URLs with base and `Astro.site`; verify after changes and adjust only if paths move.

### Files to update
- Create: `src/lib/paths.ts` (export `withBase(path: string): string`)
- Components (import `withBase` and `Image`, replace `<img>` with `<Image>`, and remove local base helpers):
  - `src/components/Hero.astro`
  - `src/components/ExperiencesSection.astro`
  - `src/components/BreakSection.astro`
  - `src/components/Footer.astro`
  - `src/components/Navbar.astro`
  - `src/components/SignupForm.astro`
  - `src/components/StorySection.astro` (only for background URL fix; already uses `<Image>` for the swoosh)
- Styles:
  - `src/styles/global.css` (make `.bg-repeating-logo` base-aware; update `@font-face` URLs after moving fonts to `src/assets/fonts`)
- Config data (leave as leading‑slash public paths; rely on `withBase` at render time):
  - `src/lib/hero.ts`, `src/lib/story.ts`, `src/lib/breakSection.ts`, `src/lib/experiences.ts`, `src/lib/navbar.ts`, `src/lib/footer.ts`, `src/lib/signupForm.ts`
- Layout (verify base variable and meta assets):
  - `src/layouts/main.astro`

### Step-by-step implementation
1. Add `src/lib/paths.ts` with `withBase(path)` that joins `import.meta.env.BASE_URL` and strips any leading slash from `path`.
2. Replace per-component base helpers:
   - In `Hero.astro`, `Footer.astro`, `Navbar.astro`, `SignupForm.astro`, and `StorySection.astro`, remove `const base = ...`/`withBase` declarations and import `{ withBase }` from `src/lib/paths`.
3. Convert all `<img>` to `<Image>` with base-aware `src`:
   - `Hero.astro`: background image layer, center logo.
   - `ExperiencesSection.astro`: icon inside the colored circle.
   - `BreakSection.astro`: background image layer.
   - `Footer.astro`: brand mark.
   - `Navbar.astro`: brand mark.
   - `SignupForm.astro`: background image layer; symbol inside the colored circle.
   - Retain classes and accessibility attributes; add `width`/`height` to each where not already present.
4. CSS backgrounds:
   - Update `.bg-repeating-logo` to `background-image: url(var(--asset-base)logos/repeating_background.png)` (or apply inline style at usage site with a base-aware URL if variable concatenation is not viable across target browsers).
   - In `StorySection.astro`, change `style="background-image: url(/images/sauna_ladle.jpeg)"` to build the URL with `withBase` (or swap to an absolutely positioned `<Image>` layer matching current styles and overlay).
5. Fonts:
   - Move `public/fonts/*` to `src/assets/fonts/*`.
   - Update `@font-face` `src:` URLs in `src/styles/global.css` to reference the new relative asset locations so Vite/Astro rewrite the URLs with the configured base.
   - Confirm the two `<link rel="preload" ...>` tags in `src/layouts/main.astro` still resolve correctly (update paths if needed).
6. Configuration and environment:
   - Confirm `astro.config.mjs` continues to derive `base` from `PUBLIC_ASTRO_BASE` and `site` from `PUBLIC_ASTRO_SITE`.
   - Ensure `src/env.d.ts` retains `readonly BASE_URL: string` so TypeScript understands `import.meta.env.BASE_URL`.

### Test / verification plan
- Local dev: run with and without `PUBLIC_ASTRO_BASE` to ensure no regressions.
- Production build: `PUBLIC_ASTRO_BASE=/pyre/ PUBLIC_ASTRO_SITE="https://<user>.github.io"` → `astro build && astro preview`.
  - Verify all images, symbols, logos, and fonts load (no 404s).
  - Inspect rendered HTML/CSS: ensure background images use base-aware URLs.
  - Check Open Graph/Twitter images resolve to absolute URLs.
  - Lighthouse sanity check: confirm image elements have width/height and images are optimized.

### Notes / non-goals
- Prefer keeping asset paths centralized in `src/lib/*` configs; continue to store copy and asset metadata there.
- If any `<Image>` usage cannot accept a string path during optimization, stage a follow-up to migrate only those assets into `src/assets` and import them statically.
