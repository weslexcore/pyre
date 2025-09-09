## Project overview / description

Add a prominent "SIGN UP" call-to-action button beneath the copy in `StorySection.astro` on the homepage. The button should guide users directly to the email waitlist signup (existing form) and encourage conversions while matching the brand and design system. Placement must work responsively across breakpoints and meet accessibility standards.

## Target audience

- Prospective guests discovering Pyre via the homepage
- Early adopters interested in wellness/sauna experiences
- Mobile-first visitors scanning for a clear next step

## Primary benefits / features

- Clear CTA: Button labeled “Join the Waitlist” placed immediately below the story text block
- Behavior: Scrolls to or reveals the existing waitlist form section on the same page (anchor `#waitlist`), with keyboard focus management
- States: Hover, focus-visible ring, and disabled/loading (if needed) for consistent feedback
- Tracking: Fire analytics event (e.g., `cta_waitlist_story_click`) on interaction to measure conversions
- Accessibility: Semantic button role, proper color contrast, and focus order preserved

## High-level tech/architecture used

- UI built with Astro components; reuse `Button.astro` styled via Tailwind per design system
- Leverage existing `SignupForm.astro` and POST to `/api/subscribe` (no new backend required)
- Place CTA within `StorySection.astro` beneath the final paragraph content; ensure responsive spacing via design tokens
- If using an in-page anchor, add/confirm an element with `id="waitlist"` near the signup form and perform smooth scroll and focus transfer

