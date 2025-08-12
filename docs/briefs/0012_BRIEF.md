# 0012 — Redesign SIGN UP Section to Match Site Sections

## Project overview / description
Update the `SIGN UP` section to visually match the headline scale and impact of other sections (e.g., `Hero`, `StorySection`). Replace the existing subdued newsletter block with a bold, section-level design that features an unused brand symbol and the `red_flowers_in_hand.jpeg` photo.

## Target audience
Visitors who want to hear about Pyre pre-opening events, news, and specials.

## Primary benefits / features
- **Headline + subheader**:
  - Headline: `SIGN UP`
  - Subheader: `Join our mailing list to hear about pre-opening events, news and specials`
- **Typography & scale**: Match the visual weight and size of major section headings (use the same sizing as `h2#story-heading` in `StorySection.astro`, uppercase with tight tracking).
- **Imagery**: Incorporate `public/images/red_flowers_in_hand.jpeg` as a strong visual element within the section (see layout below).
- **Brand symbol (unused elsewhere on page)**: Use `public/symbols/connection-symbol.png` presented prominently (e.g., inside a solid circular badge) to reinforce community and joining.
- **Responsive layout**:
  - Desktop: two-column composition — left column for heading, subheader, and form; right column as an image panel using the flowers photo. The symbol badge can overlap the image edge or sit above the heading for visual hierarchy.
  - Mobile: stack vertically with the image first, then symbol + heading, then subheader and form. Maintain generous spacing.
- **Form**: Keep existing newsletter form and submit behavior (validation and `/api/subscribe`). Button label may remain `Join the mailing list`.
- **Accessibility**: Provide descriptive `alt` text for the symbol and image or mark decorative where appropriate; maintain focus behavior for the email field when navigated from CTAs.

## High-level tech/architecture used
- **Astro + Tailwind CSS** (reuse existing patterns and utilities).
- Update `src/components/SignupForm.astro` only for structure/typography/layout; do not change server API.
- Assets:
  - Photo: `/public/images/red_flowers_in_hand.jpeg`
  - Symbol: `/public/symbols/connection-symbol.png`
- Typography: Use the same classes/scale as `StorySection` heading (`font-primary-semibold`, uppercase, tight tracking, large responsive sizes).
- Colors: Follow existing CSS variables (foreground/card) and design system rules; keep contrast high.

## Acceptance criteria
1. The section headline reads exactly `SIGN UP` and visually matches the size/weight of `RITUALS FOR MODERN LIFE` in `StorySection.astro` (uppercase, tight tracking, comparable clamp/rem values).
2. The subheader reads exactly `Join our mailing list to hear about pre-opening events, news and specials` and appears directly under the headline with appropriate spacing.
3. `red_flowers_in_hand.jpeg` is used within the section (as a full-height column or large panel) without degrading LCP; image uses `decoding="async"` and appropriate `loading` attributes based on viewport position.
4. An unused symbol on the current page is incorporated — use `connection-symbol.png` — displayed prominently (e.g., circular badge) with accessible alt text.
5. Layout is responsive: two-column on desktop, stacked on mobile/tablet, with no layout shifts; form remains functional.
6. Styling adheres to the existing design system (colors, spacing, and typography) and does not regress hero/story visuals.

## Notes
- Keep current form validation and `/api/subscribe` POST intact.
- Maintain anchor target `#signup` so existing CTAs continue to scroll/focus the email field.
- Optimize image size if needed; ensure symbol remains large and visible per symbol usage guidelines.


