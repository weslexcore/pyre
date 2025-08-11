# 0006 — Homepage Below-the-Hero Story Section

## Project overview / description
Add a new section directly below the hero on the homepage that tells the Pyre story. On desktop, the layout is a split view with the image on the left and copy on the right:
- Left: `public/images/sauna_ladle_multiexposure.jpeg` displayed full viewport height.
- Right: Text content with a large header (same size as the hero's large headline) and normal-size body text. Provide comfortable line-length and spacing for readability.

This section should visually immerse visitors while clearly communicating Pyre’s mission.

## Target audience
- Prospective members and first‑time visitors curious about Pyre
- Community/partner stakeholders evaluating brand and offering

## Primary benefits / features
- Strong visual storytelling with immersive photography
- Clear, aspirational narrative explaining what Pyre is building
- Desktop-first split layout; responsive behavior so the section remains legible on all screens
- Accessibility: meaningful alt text and semantic structure
- Performance: optimized image delivery and layout stability

## High-level tech / architecture used
- Astro with Tailwind CSS for layout and typography
- Create `src/components/StorySection.astro` and place it below `Hero` in `src/pages/index.astro`
- Use the image at `public/images/sauna_ladle_multiexposure.jpeg` with descriptive `alt`
- Ensure responsive behavior (e.g., stacked layout on small screens) and apply existing typography scale to match hero sizing

## Copy (exact text)
Header: RITUALS FOR MODERN LIFE

Body:

At Pyre, we’re reimagining the ancient traditions of saunas and cold baths for a modern era.

For thousands of years, these healing practices have brought communities together, fostering deep connections while providing restorative experiences for both body and mind. This environment is designed to cultivate joy and meaningful connection, whether you're seeking quiet personal reflection or want to explore a unique social setting.

It’s an experience that aims to prioritize your health and help you reconnect with what truly matters, so you’ll leave feeling better than when you walked in. Here, meaningful change begins, one restorative experience at a time.


