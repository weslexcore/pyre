# 0007 — Navbar Fade‑in on Scroll

## Project overview / description
Introduce a transparent navbar that smoothly fades to a black background once the user begins scrolling the page (leaving the top/hero). While at the very top of the page, the navbar remains transparent to showcase the hero imagery; past the threshold, it gains a subtle black background (with optional slight blur and shadow) to improve contrast and legibility.

## Target audience
- All site visitors across devices (mobile, tablet, desktop)
- Marketing/landing page viewers who often begin at the hero

## Primary benefits / features
- Enhanced readability of navigation items against varied background content
- Clear visual state indicating the page is scrolled
- Polished, modern feel that complements brand aesthetics
- Accessibility: maintain sufficient text contrast; respect reduced‑motion preferences
- Performance: no layout shift and minimal main‑thread work

## High-level tech / architecture used
- Astro with Tailwind CSS for styling and transitions
- Use an IntersectionObserver on a top sentinel (e.g., hero or a 1px spacer) to toggle a `scrolled` state
- Apply conditional classes on the navbar when `scrolled` is true: background `bg-black/80` (or `bg-black`), `transition-colors` and `duration-200–300`; optional `backdrop-blur` and `shadow`
- Respect `prefers-reduced-motion` by shortening/removing transition durations for users who opt out
- Ensure consistent behavior across all pages that use the main layout navbar
