### 1. Project overview / description
Ensure that on desktop breakpoints, the email text input and submit button in the sign‑up form are perfectly aligned on the same baseline/height. The button currently sits a few pixels lower; this fix delivers a crisp, consistent horizontal alignment without changing mobile behavior.

### 2. Target audience
- Desktop visitors subscribing to updates
- Accessibility-focused users who rely on visible focus states and predictable layouts

### 3. Primary benefits / features
- Pixel-consistent vertical alignment between input and submit button at desktop widths
- Matched control heights, padding, and border treatments for a unified appearance
- Preserves existing mobile layout and interactions
- Consistent focus styles and hit area for both controls
- Cross-browser consistency (Chrome, Safari, Firefox)

### 4. High-level tech/architecture used
- Update `src/components/SignupForm.astro` styling using Tailwind CSS first (per design system):
  - Use a shared layout container (flex or grid) with alignment utilities (e.g., `items-stretch` or `items-center`) at `md:` and above
  - Normalize control metrics: matching `h-*`, `leading-*`, `px/py`, `border` widths, and `rounded` radii
  - Ensure consistent font size and line-height across both controls at desktop
  - Verify focus ring/outline tokens are consistent and do not alter computed height
- If needed, centralize any shared control styles in `src/styles/global.css` without breaking component encapsulation
- Test across breakpoints and browsers to confirm no layout shift and correct alignment

