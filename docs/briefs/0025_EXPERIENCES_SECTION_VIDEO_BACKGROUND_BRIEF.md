# Experiences Section Video Background

## 1. Project overview / description
Add a subtle, ambient video background to the `ExperiencesSection` using `public/videos/running_water.MOV`. The video should span the full page width while the section height remains driven only by its content. The video must autoplay, be muted, loop seamlessly, and play at half speed for a calming effect.

## 2. Target audience
- Visitors exploring the Experiences section who benefit from a calming, immersive visual backdrop that enhances brand feel without distracting from content.

## 3. Primary benefits / features
- Full-width background video behind `ExperiencesSection` content
- Section height determined by content (no full-screen takeover)
- Autoplay, muted, loop enabled; playback at 0.5× speed
- No visible media controls; video should not interfere with text readability
- Graceful behavior on mobile/low-power: still renders content with unobtrusive video
- Fallback handling if video fails to load (content must remain legible)

## 4. High-level tech/architecture used
- Use a background `<video>` element within `src/components/ExperiencesSection.astro` positioned behind content (absolute/relative stacking with z-index)
- Source path: `/videos/running_water.MOV` from `public/videos`
- Attributes: `autoplay`, `muted`, `loop`, `playsinline`; set `playbackRate = 0.5` via client-side script on mount
- Ensure responsive layout: video set to cover width while maintaining aspect ratio; container height remains content-driven
- Performance: preload metadata only, consider `object-fit: cover`, and apply lazy loading strategies as appropriate

