### Brief description

Replace the current CSS-based repeating logo background with Astro's built-in Image pipeline while preserving the exact tiling/repeat effect and layout across breakpoints. The goal is to improve LCP and overall page performance by leveraging optimized assets (modern formats, caching) without altering the visual outcome. Content is decorative and must not impact accessibility semantics.

Verbatim requirements from the brief:
- Use Astro `Image` for optimized responsive delivery (AVIF/WebP fallbacks, `srcset`, dimensions).
- Preserve the existing repeating/tiling effect for the logo background across all supported breakpoints and densities.
- Proper `alt`/decorative handling depending on context (likely decorative).
- Lazy-load when offscreen; preload/prioritize if used above the fold.
- Ensure crisp rendering on high-DPI screens; avoid layout shifts via explicit width/height.
- Source asset moved under `src/assets/logos/` for build-time optimization (replacing current `public/logos/repeating_background.png`).

### Files to create/update

- Create: `src/components/RepeatingLogoBackground.astro`
  - Encapsulates the repeating/tiling background implemented via Astro's image pipeline.
  - Accepts sizing/positioning props and renders a decorative container with an inline CSS `background-image` using optimized asset URLs.

- Move/rename asset:
  - From: `public/logos/repeating_background.png`
  - To: `src/assets/logos/repeating_background.png`

- Update usages of the existing CSS helper class `.bg-repeating-logo`:
  - `src/components/StorySection.astro` (top and bottom decorative strips)
  - `src/components/Footer.astro` (component root background layer)

- Update or deprecate CSS:
  - `src/styles/global.css`
    - Current rule:
      - `.bg-repeating-logo { background-image: url(/logos/repeating_background.png); background-repeat: repeat; background-size: 240px 240px; }`
    - Either remove this class or keep it as a fallback with a comment stating it is superseded by `RepeatingLogoBackground.astro`.

- Helpers (no structural change required, but will be referenced):
  - `src/lib/paths.ts` (`withBase`) for base-path safe URL construction when composing inline CSS values.

### Implementation details and step-by-step algorithm

1) Asset pipeline via `astro:assets`
   - Import the source tile: `src/assets/logos/repeating_background.png` into the new component.
   - Produce fixed-dimension optimized derivatives for a tile size of 240×240px (current CSS uses `background-size: 240px 240px`).
     - Generate at least two formats for broad support and performance:
       - WebP: 240×240 (primary)
       - PNG: 240×240 (fallback)
     - Note: CSS backgrounds cannot use `srcset`; use CSS `image-set()` to provide multiple formats. This retains some modern-format benefits while ensuring a robust fallback.

2) Compose a reusable component API: `src/components/RepeatingLogoBackground.astro`
   - Props (examples; do not hardcode implementation here):
     - `tileSizePx` (default 240) used to compute `background-size: ${tileSizePx}px ${tileSizePx}px`.
     - `positionClass` (pass-through Tailwind classes such as `bg-center`, or custom) for `background-position`.
     - `class` (height/width/positioning; e.g., `h-16 w-full` or `absolute inset-0`).
     - `priority`/`preload` hint for above-the-fold contexts (Footer may not be above the fold; story borders generally are near top).
   - Render a semantic-neutral container (`div`) with `aria-hidden="true"` and no landmark role.
   - Inline styles set:
     - `background-image: image-set(url(<webpUrl>) type('image/webp'), url(<pngUrl>) type('image/png'))`.
     - `background-repeat: repeat`.
     - `background-size: <tileSizePx>px <tileSizePx>px`.
     - Optionally `background-position` via classes/props.
   - Construct each URL using `withBase(...)` to remain base-path aware in preview and on GitHub Pages.
   - Ensure the component does not introduce layout shift: height/width must be controlled by caller via classes; the background layer itself does not affect layout.

3) Replace existing usages
   - `src/components/StorySection.astro`
     - Replace the two `div` elements that currently rely on `.bg-repeating-logo` with `RepeatingLogoBackground` instances.
     - Preserve classes for height and width (e.g., `h-16 w-full`) and `bg-center` positioning.
     - Keep `aria-hidden="true"` as decorative.
   - `src/components/Footer.astro`
     - Replace the root `bg-repeating-logo` usage with a background layer built using `RepeatingLogoBackground`.
       - E.g., render `RepeatingLogoBackground` as an absolutely positioned child `absolute inset-0` behind content, retain the existing `--pyre-black` overlay layer to maintain contrast.
     - Keep footer semantics and z-index layering: background (tile) → contrast overlay → content.

4) CSS cleanup
   - In `src/styles/global.css`, remove or clearly mark `.bg-repeating-logo` as deprecated with a comment referencing the new component.
   - If kept as a fallback, ensure it is not referenced by components and that any remaining usage is intentional.

5) Base path and deployment
   - All generated asset URLs must be base-aware. `withBase()` should wrap both WebP and PNG URLs used in `image-set()`.
   - Verify locally with a non-root base (e.g., `astro preview --base /pyre-astro/`) and on GitHub Pages that backgrounds render correctly.

6) Performance and quality controls
   - Tile size: keep at 240×240px to match current visual cadence. If visual testing on high-DPI screens shows blur, consider generating a 2× tile (480×480) and adjusting `background-size` down to 240×240 to ensure pixel density (still using `image-set()` with both tile densities). Start simple with 240×240 and iterate only if needed.
   - Since CSS cannot `lazyload` background images, rely on small tile size and caching. The overlay content remains unchanged.
   - For any above-the-fold usage, consider adding a `<link rel="preload" as="image">` for the chosen tile URL in the layout if a measurable benefit is observed. Keep this optional pending LCP data.

### Acceptance considerations (non-exhaustive)

- Visual parity: The tiling pattern in `StorySection` borders and the `Footer` matches the current site in spacing, alignment, and density across common breakpoints (mobile through desktop).
- Accessibility: Decorative only, `aria-hidden="true"`, no alt text exposed to screen readers.
- Base-path correctness validated in local preview with a non-root base and in production (GitHub Pages).
- Performance: No CLS introduced; small, cacheable tile. Image assets are served from Astro's pipeline outputs.

### Rollout steps

1. Add the new component and move the asset into `src/assets/logos/`.
2. Wire `StorySection.astro` and `Footer.astro` to use the component; keep old CSS class unused.
3. Validate visually on 375px, 768px, 1024px, 1280px, 1440px.
4. Remove or deprecate `.bg-repeating-logo` from `global.css` with a comment.
5. Preview with a non-root base; deploy and verify.


