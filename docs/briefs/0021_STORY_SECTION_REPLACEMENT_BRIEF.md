### Project overview / description
Replace the existing `StorySection` with a new, full-bleed narrative section. Keep the same copy and primary button. Use `@sauna_ladle.jpeg` as a full-bleed background with an opacity/overlay so white text remains readable. Place `@swoosh.png` (transparent) above the text on mobile and to the left of the text on desktop. Maintain the repeating logo border. The entire section, including the border, must occupy 100vh.

### Target audience
- Visitors scanning the brand story on mobile and desktop
- Prospective members seeking a quick, visually rich overview

### Primary benefits / features
- Full-bleed background (`public/images/sauna_ladle.jpeg`) with overlay for text contrast
- Copy and CTA unchanged; behavior identical to current section
- `public/symbols/swoosh.png` positioned above copy on mobile, left of copy on desktop; no background
- Repeating logo border preserved
- Section height is exactly 100vh including the border
- Accessibility: WCAG AA contrast for text; decorative images marked appropriately

### High-level tech / architecture
- Implement as a replacement component for `src/components/StorySection.astro` (or new component swapped in `src/pages/index.astro`)
- Source copy from `src/lib/story.ts`; keep CTA using existing `Button.astro`
- Tailwind-first styling; use background-cover and an absolute overlay for opacity
- Responsive layout: single column (mobile) with swoosh above; two-column (desktop) with swoosh left, copy right
- Assets used: `public/images/sauna_ladle.jpeg`, `public/symbols/swoosh.png`, existing repeating logo border asset (e.g., `public/logos/repeating_background.png`)
- Ensure no CLS; lazy-load where appropriate; keep 100vh including border without overflow
