### 1. Project overview / description
Design a site-wide footer that incorporates the brand pattern and color, and clearly presents essential business info. The footer must use the repeating background image and the brand color `--pyre-black`, and include hours, location, email `hi@pyresauna.com`, a link to Instagram, and the full logo.

### 2. Target audience
- Visitors exploring Pyre Sauna online (mobile-first)
- Prospective guests seeking location, hours, and contact details
- Returning customers looking for quick access to Instagram and email

### 3. Primary benefits / features
- **Branded visuals**: Background pattern using `public/logos/repeating_background.png` with `--pyre-black` as the primary color treatment and sufficient contrast for readability.
- **Business info**: Prominent sections for hours, physical location (address), and contact email `hi@pyresauna.com`. Hours and location should have "Coming Soon"
- **Social link**: Instagram link (opens in new tab), with accessible label and recognizable icon.
- **Brand mark**: Display the full Pyre logo (use existing asset from `public/logos/creme/logo.png` or equivalent), with descriptive alt text.
- **Responsive layout**: Stacked layout on small screens; multi-column layout on larger screens. Adequate spacing and clear hierarchy.
- **Accessibility**: Meets WCAG AA contrast; keyboard-focus styles visible; semantic landmarks (`<footer>`), proper link names.

### 4. High-level tech/architecture used
- **Astro component**: Implement as `src/components/Footer.astro` and include in the base layout so it appears across pages.
- **Styling**: Tailwind CSS first; apply `background-image: url('/logos/repeating_background.png')` with overlays/tints using `--pyre-black` and safe contrast for text and icons.
- **Assets**: Use existing public assets (`public/logos/repeating_background.png`, full logo in `public/logos/creme/`).
- **Links & data**: Hardcode `hi@pyresauna.com` and Instagram URL initially; consider extracting to a small config if needed later.

