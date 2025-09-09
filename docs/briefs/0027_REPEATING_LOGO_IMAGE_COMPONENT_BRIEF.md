## Project overview / description

Replace the current CSS-based repeating logo background with Astro's built-in `Image` component to gain automatic image optimization (responsive `srcset`, modern formats, lazy-loading, and caching). Maintain the same visual tiling/repeat effect and layout across breakpoints while improving LCP and overall page performance.

## Target audience

- Site visitors on mobile and desktop (faster loads, better responsiveness)
- Internal developers maintaining background/brand elements (simpler, consistent image handling)
- SEO/performance stakeholders (improved Core Web Vitals)

## Primary benefits / features

- Use Astro `Image` for optimized responsive delivery (AVIF/WebP fallbacks, `srcset`, dimensions).
- Preserve the existing repeating/tiling effect for the logo background across all supported breakpoints and densities.
- Proper `alt`/decorative handling for accessibility depending on context (likely decorative).
- Lazy-load when offscreen; preload/prioritize if used above the fold.
- Ensure crisp rendering on high-DPI screens; avoid layout shifts via explicit width/height.

## High-level tech/architecture used

- Astro `Image` from `astro:assets` with explicit `widths`/`sizes` appropriate for the container.
- Source asset moved under `src/assets/logos/` for build-time optimization (replacing current `public/logos/repeating_background.png`).
- Implement repeat/tiling via layout strategies (e.g., duplicating `Image` tiles within a container or generating an optimized URL and repeating via CSS where appropriate) while retaining performance gains.
- Update relevant components/sections that currently reference the CSS background to use the new image delivery approach without regressions in layout.


