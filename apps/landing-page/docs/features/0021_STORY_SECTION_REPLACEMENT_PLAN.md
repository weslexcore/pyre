## 0021 — Story Section Replacement — Plan

### Context
Replace the existing `StorySection` with a full-bleed narrative section. Keep the same copy and primary CTA from `src/lib/story.ts`. Use `public/images/sauna_ladle.jpeg` as a full-bleed background with a contrast overlay so white text remains readable. Place `public/symbols/swoosh.png` above the text on mobile and to the left of the text on desktop. Preserve the repeating logo border. The entire section height (including the border) must be exactly 100vh with no overflow or CLS.

### Files to Modify
- `src/components/StorySection.astro`
  - Replace the current split-image/text layout with a full-bleed background section, carrying over copy and CTA.
- `src/pages/index.astro`
  - Keep usage as `<StorySection />` in order under `<Hero />` and before `<BreakSection />` and `<SignupForm />`. No structural changes required besides ensuring the new component still renders here.

### Data sources (unchanged)
- `src/lib/story.ts`
  - Use `story.elements.title`, `story.elements.body`, and `story.actions.primary` verbatim.
  - Do not change `story.ts`; override the section’s background image in the component (using the new `sauna_ladle.jpeg`).

### Assets
- Background: `public/images/sauna_ladle.jpeg`
- Swoosh symbol: `public/symbols/swoosh.png`
- Repeating border: existing `.bg-repeating-logo` (uses `public/logos/repeating_background.png` and is base-aware via `var(--asset-base)` in `src/styles/global.css`)

### Layout and styling (Tailwind-first)
- Root structure
  - Root `<section>` is a flex column container: top border, content, bottom border.
  - Enforce total height of 100vh including borders:
    - `section`: `min-h-[100dvh] flex flex-col`
    - Top and bottom borders: fixed height (match current `h-16`).
    - Middle content wrapper: `flex-1 min-h-0` to consume the remaining height.
- Background image and overlay
  - Implement background as an absolutely positioned, full-bleed layer inside the content wrapper (`absolute inset-0 bg-cover bg-center`).
  - Use a base-aware URL: `background-image: url(var(--asset-base)images/sauna_ladle.jpeg)`.
  - Add an absolutely positioned overlay on top of the background (e.g., `bg-[rgba(0,0,0,0.4)]`) to meet contrast.
- Content grid
  - Inside the content wrapper, center content within the standard page width container used elsewhere (`px-4` and `sm:*/md:*/lg:*/xl:*` max-width utilities, consistent with Hero and existing StorySection).
  - Mobile (default): single column stack — swoosh above, then text block.
  - Desktop (`md+`): two columns — swoosh left (auto width), text right (flexible width). Use a grid or CSS grid `grid-cols-[auto_1fr]` or equivalent utilities.
- Typography and colors
  - Use white/brand creme text: `text-[var(--pyre-creme)]` for all copy over the darkened overlay.
  - Heading mirrors current scale/tracking in `StorySection`/Hero: uppercase, `font-primary-semibold`, `tracking-[-0.02em]`, size via `text-[clamp(...)]` consistent with current implementation.

### Border (repeating logo) handling
- Preserve both top and bottom borders using the existing helper class:
  - Top: `<div aria-hidden="true" class="bg-repeating-logo bg-center h-16 w-full" />`
  - Bottom: same as top.
- Because the root is `flex flex-col` with fixed-height borders and `flex-1` content, the total height remains exactly 100vh without extra scrolling.

### Swoosh placement and behavior
- Use an `<img>` for `public/symbols/swoosh.png`:
  - Mobile: render above the text block; center horizontally.
  - Desktop: place in the left column adjacent to the text.
  - Constrain size with responsive utilities (e.g., `w-24 sm:w-28 md:w-32 lg:w-36`), maintain aspect via `h-auto`.
  - Accessibility: decorative; set `alt=""` and `aria-hidden="true"`.
  - Performance: `loading="lazy"` and `decoding="async"`; include explicit `width` and `height` attributes to prevent CLS.

### Text and CTA block
- Source title/body/CTA from `story` config as today.
- Body renders paragraphs in order; preserve any list/emphasis behavior if present.
- CTA uses `Button.astro` with the same props from `story.actions.primary`.

### Accessibility and performance
- Contrast: ensure overlay opacity provides WCAG AA for all text over the background.
- Semantics: keep `aria-labelledby` on the section and `id` on the heading.
- Images:
  - Background is decorative via CSS background — no alt needed.
  - Swoosh `<img>` is decorative: `alt=""` and `aria-hidden="true"`.
- CLS: set explicit `width`/`height` on swoosh and maintain stable layout containers.
- Lazy loading: swoosh is lazy; content is immediate.

### Step-by-step implementation
1. In `src/components/StorySection.astro`, replace the current grid split layout with a `flex flex-col` root, keeping the top and bottom `.bg-repeating-logo` borders at `h-16`.
2. Wrap the central content in a `relative` container with `flex-1 min-h-0`.
3. Add an absolutely positioned full-bleed background layer inside the content wrapper using `background-image: url(var(--asset-base)images/sauna_ladle.jpeg)` with `bg-cover bg-center`.
4. Add an absolute semi-opaque overlay (`rgba(0,0,0,0.35–0.5)`) above the background for contrast.
5. Add an inner max-width container following the same responsive width classes used in Hero/Story; ensure vertical centering within the content wrapper.
6. Build the content layout:
   - Mobile: stack swoosh `<img>` (decorative) above the text block, centered.
   - Desktop: switch to a two-column grid (`auto` for swoosh, `1fr` for text) with gap utilities; align vertically centered.
7. Render `story.elements.title`, `story.elements.body`, and the `<Button>` using `story.actions.primary` without changes to the content source.
8. Remove the old symbol treatments (blue circular badge, mobile overlay badge) from the previous component version.
9. Verify the section occupies the full viewport height including borders at common breakpoints; adjust content wrapper padding/margins to prevent overflow.
10. Audit contrast and keyboard/focus order; ensure the CTA is reachable and visible against the overlay.

### Validation checklist
- Section total height is exactly 100vh including top and bottom repeating borders; no vertical overflow.
- Background uses `sauna_ladle.jpeg` full-bleed with a contrast overlay; text remains readable.
- Swoosh appears above text on mobile and to the left of text on desktop; decorative and non-interactive.
- Copy and CTA are unchanged and sourced from `src/lib/story.ts`.
- Repeating logo border preserved and base-aware via existing `.bg-repeating-logo` class.
- No CLS introduced; explicit dimensions on swoosh; stable layout containers.

