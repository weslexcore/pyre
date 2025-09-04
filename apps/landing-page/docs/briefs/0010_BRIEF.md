### Project overview / description
Replace all usages of pure white in CSS with the Pyre Creme brand color to align the UI with Pyre’s design system and soften high-contrast edges. This includes updating color references in styles and utility classes where white is explicitly set.

### Target audience
- Site visitors (improved visual warmth and consistency)
- Design and engineering teams (brand alignment, maintainable theming)

### Primary benefits / features
- Brand consistency: use Pyre Creme for light surfaces and highlights instead of pure white
- Visual cohesion: warmer, less sterile look across components and pages
- Accessibility: verify contrast meets WCAG AA when replacing white on dark backgrounds
- Comprehensive replacement scope (CSS-only):
  - Replace explicit whites such as #fff, #ffffff, rgb(255, 255, 255), hsl(0 0% 100%), and the keyword "white"
  - Replace utility/class usages that map to white (e.g., text/background/border utilities)
  - Exclude raster/vector image assets; handle only CSS-defined colors
- Acceptance criteria:
  - All CSS-defined whites replaced with Pyre Creme
  - No regressions in readability or contrast on key templates/components
  - Visual QA completed on hero, navbar, buttons, forms, and content sections

### High-level tech/architecture used
- Color token: Pyre Creme = rgb(250, 248, 236) per the design system
- Centralize via theme token:
  - Prefer a CSS custom property (e.g., a creme token) referenced across styles
  - If using Tailwind, expose a `creme` color in the theme and migrate utilities to that token
- Implementation approach:
  - Inventory CSS declarations and utilities that set white
  - Replace with the centralized Pyre Creme token
  - Run accessibility checks (contrast) and perform spot visual QA


