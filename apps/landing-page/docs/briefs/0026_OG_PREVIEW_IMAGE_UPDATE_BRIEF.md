# Open Graph / Social Preview Image Update

## 1. Project overview / description
Update the website’s social sharing preview image so that links shared on messaging apps, search engines, and social platforms display a branded visual. Use `public/images/sauna_ladle_multiexposure.jpeg` as the canonical preview image across Open Graph and Twitter Card metadata.

## 2. Target audience
- People sharing the site via Messages, WhatsApp, Slack, Facebook, LinkedIn, X/Twitter, and Google surfaces
- Marketing and content teams who need consistent, on-brand link previews

## 3. Primary benefits / features
- Consistent preview image across major platforms (OG + Twitter)
- Absolute URL for the image to ensure external crawlers can fetch it
- Proper dimensions and compression for fast loading and high-quality display (target 1200×630, <300KB)
- Fallback behavior defined if image is missing; no broken previews
- Single source of truth for site-wide default preview image, with option for page-level overrides later

## 4. High-level tech/architecture used
- Asset location: `public/images/sauna_ladle_multiexposure.jpeg`
- Define site-wide default meta tags in `src/layouts/main.astro` (or shared head include) using Open Graph and Twitter Card tags:
  - `og:image`, `og:image:width`, `og:image:height`, `og:image:alt`
  - `twitter:card` (summary_large_image), `twitter:image`, `twitter:image:alt`
- Ensure absolute image URL generation via existing base/path utilities (see `src/lib/paths.ts`) and `astro.config.mjs` `site` value
- Verify previews with platform debuggers (e.g., Facebook Sharing Debugger, Twitter/X Card Validator, LinkedIn Post Inspector)


