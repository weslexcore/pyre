# 0008 — Sauna Symbol Above "RITUALS FOR MODERN LIFE"

## Project overview / description
Add the sauna symbol image above the "RITUALS FOR MODERN LIFE" heading in the story section. The provided asset is white and must be displayed inside a solid black circular background to ensure contrast. The icon should be centered, balanced with the heading, and responsive across breakpoints.

## Target audience
- Visitors reading the story section on the landing page (mobile, tablet, desktop)
- Brand/creative stakeholders verifying visual identity cues

## Primary benefits / features
- Strong brand cue that anchors the story section
- Guaranteed contrast and legibility for a white icon via a black circular background
- Clean, balanced composition above the section title
- Accessible alt text and non-decorative semantics when appropriate

## High-level tech/architecture used
- Astro with Tailwind CSS for layout and styling
- Asset: `public/symbols/sauna-symbol.png`
- Wrap the image in a square container with a perfect circular black background; center the icon within
- Suggested sizing: approximately 64–96px diameter on mobile, scaling up to 96–128px on larger screens; maintain aspect ratio of the source image
- Ensure adequate spacing from the heading (e.g., margin-bottom that adapts by breakpoint)
- Provide descriptive `alt` text (e.g., "Sauna symbol") or mark as decorative if redundant with nearby text


