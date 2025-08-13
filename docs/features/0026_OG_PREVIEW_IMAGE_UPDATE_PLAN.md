# 0026 — Open Graph / Social Preview Image Update — Technical Plan

## Description
Update the site-wide default Open Graph and Twitter Card preview image so links render a consistent, branded visual. Use `public/images/sauna_ladle_multiexposure.jpeg` as the canonical image across OG and Twitter. Ensure absolute URL generation, add width/height/alt metadata, and keep a single source of truth with room for future page-level overrides.

## Files to update
- `src/layouts/main.astro`
  - Replace the current social image path (logos asset) with `images/sauna_ladle_multiexposure.jpeg`.
  - Keep base-aware path construction using `import.meta.env.BASE_URL`.
  - Compute an absolute URL using `Astro.site` so external crawlers can fetch the image.
  - Add missing tags: `og:image:width`, `og:image:height`, `og:image:alt`, and `twitter:image:alt`.
  - Preserve existing `twitter:card` set to `summary_large_image`.

- `src/lib/paths.ts` (optional enhancement)
  - Add a helper to build absolute URLs when `Astro.site` is available (e.g., `withAbsolute(path: string, site?: string | URL)`), or continue computing in `main.astro` if keeping scope tight.

- `src/lib/seo.ts` (new config module)
  - Centralize social meta defaults per "single source of truth" and existing copy-in-lib convention:
    - `SOCIAL_IMAGE_PATH = "images/sauna_ladle_multiexposure.jpeg"`
    - `SOCIAL_IMAGE_ALT = "Sauna ladle multi-exposure — Pyre Sauna + Cold Plunge"` (or similar, on-brand)
    - `SOCIAL_IMAGE_WIDTH = 1200`
    - `SOCIAL_IMAGE_HEIGHT = 630`

- `astro.config.mjs`
  - No functional change needed; confirm `site` is wired to `PUBLIC_ASTRO_SITE` as already configured so absolute URLs can be generated in production builds.

## Step-by-step implementation details
1. In `src/lib/seo.ts` (new), export constants for the image path, alt text, and dimensions. This ensures a single source of truth and supports future reuse.
2. In `src/layouts/main.astro`:
   - Import the constants from `src/lib/seo.ts`.
   - Build `socialImagePath` using the base-aware approach (`import.meta.env.BASE_URL`) and the constant path `images/sauna_ladle_multiexposure.jpeg`.
   - Compute `absoluteSocialImage` using `Astro.site ? new URL(socialImagePath, Astro.site).toString() : socialImagePath` so it becomes absolute when `site` is configured, otherwise falls back gracefully for local dev.
   - Set the following meta tags in the `<head>`:
     - `og:image` = `absoluteSocialImage`
     - `og:image:width` = `1200`
     - `og:image:height` = `630`
     - `og:image:alt` = alt constant
     - `twitter:card` = `summary_large_image` (already present)
     - `twitter:image` = `absoluteSocialImage`
     - `twitter:image:alt` = alt constant
   - Keep `og:url` and `twitter:url` using `Astro.site` when available.

3. Verify asset presence and performance:
   - Confirm `public/images/sauna_ladle_multiexposure.jpeg` exists.
   - Target dimensions 1200×630 and file size <300KB as specified. If larger, compress the JPEG to meet the budget without noticeable quality loss.

## Notes on URL generation
- Absolute URL requirement: external crawlers (Facebook, X/Twitter, LinkedIn) should receive a fully-qualified URL. Using `Astro.site` plus `new URL(relative, site)` satisfies this.
- Base path handling: keep `import.meta.env.BASE_URL` in the constructed relative path so the app works under subpaths (e.g., GitHub Pages project site).

## Validation
- Local: `astro build && astro preview` then inspect the rendered `<head>` to confirm OG and Twitter tags expose the absolute URL when `PUBLIC_ASTRO_SITE` is set, or a base-aware relative URL locally.
- Platform debuggers:
  - Facebook Sharing Debugger: scrape to refresh cache and verify image/alt/dimensions.
  - X/Twitter Card Validator: verify `summary_large_image` uses the correct asset.
  - LinkedIn Post Inspector: confirm the preview image and alt.

## Future extension (not in scope now)
- Page-level overrides: allow pages to pass `socialImage`, `socialImageAlt`, `socialImageWidth`, `socialImageHeight` props to `Layout`, falling back to the defaults from `src/lib/seo.ts`.


