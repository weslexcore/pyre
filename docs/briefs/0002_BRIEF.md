### Project overview / description
Ensure the hero section displays the brand logo perfectly centered on the page and doubled in size. The copy "Self-care." should sit to the far left of the logo and "Together." to the far right, all on the same horizontal line. The logo’s centering must be maintained regardless of surrounding text, images, or other content.

### Target audience
- Visitors landing on the homepage across mobile, tablet, and desktop
- Prospective customers forming a first impression of the brand

### Primary benefits / features
- Perfect, content-agnostic centering of the hero logo
- Logo displayed at 2× its current size
- Flanking copy: "Self-care." on the left and "Together." on the right of the logo
- Responsive layout that holds across common breakpoints
- Accessibility: semantic markup, alt text for the logo, readable text contrast
- Performance: optimized image asset usage, no layout shift

### High-level tech/architecture used
- Astro pages and layout: update `src/pages/index.astro` and, if needed, `src/layouts/main.astro`
- CSS: implement a robust, responsive layout (prefer CSS Grid with three columns or a flex layout with center anchoring) in `src/styles/global.css` or a co-located style block
  - Enforce a hero container that establishes centering independent of other content (e.g., grid with `grid-template-columns: 1fr auto 1fr`, `place-items: center`)
  - Double the logo’s rendered size with responsive constraints (e.g., `clamp`-based sizing)
- Assets: use existing logo from `public/logos/...` with appropriate `alt`
- QA: test at multiple viewport widths to verify centering and spacing


