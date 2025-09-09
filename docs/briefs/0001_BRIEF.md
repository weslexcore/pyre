## Pyre Sauna + Cold Plunge — Landing Page (Hero)

### 1) Project overview / description
Create the initial landing page hero for Pyre Sauna + Cold Plunge using the existing Pyre design system. The hero experience fills the viewport, with a transparent top navigation and brand elements over a full-bleed background image. The goal is to clearly communicate the brand, location, and opening timeline, and capture visitor emails. For now, only implement the hero section.

### 2) Target audience
- Richmond, VA residents interested in wellness, sauna, and cold plunge
- Community‑minded individuals seeking shared self‑care experiences
- Early supporters who want opening updates and special offers

### 3) Primary benefits / features
- Transparent navbar across the top, with `logo_with_text` in the top-left
- Full-viewport hero section (exactly 100vh x 100vw) using `public/images/hero.png`
- Centered brand logo overlay in the hero
- Hero copy:
  - “The Bathhouse Reimagined for Richmond”
  - “Self-care. Together.”
  - “Richmond, VA Spring 2026”
- Newsletter signup (email field + submit), following design system input/button patterns
- Responsive, accessible (keyboard focus, labels), and performant (optimized image)

### 4) High-level tech / architecture
- Tech: Astro project, TypeScript, Pyre Design System tokens (colors, type, spacing), CSS modules/global styles per repo conventions
- Assets: background `public/images/hero.png`; logo `public/logos/*/logo_with_text.png`
- Layout: use existing `src/layouts/main.astro` and add a dedicated hero section on `src/pages/index.astro`
- Components: semantic HTML with design-system classes (e.g., nav, heading hierarchy, form controls)
- Accessibility: labeled email input, descriptive button text, sufficient color contrast over image

