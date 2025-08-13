# Experiences Section Video Background — Technical Plan (0025)

Brief: Add a subtle, ambient video background to the `ExperiencesSection` using `public/videos/running_water.MOV`. The video spans the full page width while the section height remains driven only by its content. The video must autoplay, be muted, loop seamlessly, have no visible controls, play at 0.5× speed, and not interfere with text readability. Include graceful behavior on mobile/low‑power and a fallback if the video fails to load.

## Files to change / create
- `src/components/ExperiencesSection.astro`: Integrate a background video element, stacking behind existing content; add a small inline script to set playback rate to 0.5×.
- `src/lib/paths.ts`: Use existing `withBase(path)` helper for the video `src` to respect `BASE_URL` in all environments.
- `public/videos/running_water.MOV`: Ensure file exists (source path `/videos/running_water.MOV`). No code changes.
- `src/styles/global.css`: No required changes; Tailwind utility classes will handle layout, stacking, and responsiveness. Optional: add a global helper class if readability overlay is needed.

## Implementation details
1. Container stacking and layout
   - Keep the section as the stacking context with `position: relative` (already present via Tailwind classes in `ExperiencesSection.astro`).
   - Insert a video wrapper as the first child inside the section: absolutely positioned with `inset: 0`, full width/height, and a negative z-index so it sits behind the content.
   - Maintain content-driven height by not constraining the section height; the absolutely positioned video will size to the section’s current height, which is defined by content.

2. Video element configuration
   - Place a `<video>` element inside the wrapper with attributes: `autoplay`, `muted`, `loop`, `playsinline`, `preload="metadata"`. Do not show controls.
   - Use `src={withBase('/videos/running_water.MOV')}` to ensure compatibility with non-root `BASE_URL` deployments.
   - Apply responsive fit: make the video cover the container while preserving aspect ratio using `object-fit: cover` and stretch to full width/height.
   - Add an optional subtle overlay layer (absolute, `inset: 0`, low-opacity creme/neutral) above the video but below content, to preserve text readability if needed.

3. Playback rate 0.5×
   - Add a small inline script in `ExperiencesSection.astro` that:
     - Selects the video element on load.
     - On `loadedmetadata` (or `canplay`) event, sets `video.playbackRate = 0.5`.
     - Catches and ignores errors if the browser blocks autoplay; leave content unaffected.

4. Accessibility and reduced motion
   - Respect user preference: if `prefers-reduced-motion: reduce` is detected, avoid autoplaying and pause the video immediately after `loadedmetadata`. The content remains fully legible over the section background.
   - Ensure no controls are visible and the video is marked `aria-hidden="true"` since it is decorative only.

5. Performance considerations
   - Use `preload="metadata"` to avoid fetching full media before interaction/visibility.
   - Defer playback until in viewport using a lightweight `IntersectionObserver` (optional enhancement): if implemented, only call `video.play()` when the section enters the viewport; pause when it exits to save resources on mobile.
   - Ensure the video element is `muted` and `playsinline` to satisfy mobile autoplay policies.

6. Graceful failure / fallback
   - If the video fails to load, the section’s background color (`bg-[var(--pyre-creme)]`) remains visible; content layout is unchanged.
   - Optionally provide a `poster` image for faster first paint; not required by the brief.

## Step-by-step edits in `ExperiencesSection.astro`
- Wrap existing content with an absolutely positioned background layer that contains the video.
- Keep the current grid/content structure intact.
- Insert inline script to:
  - Set playback rate to 0.5× after metadata loads.
  - Respect `prefers-reduced-motion` and pause when true.
  - Optionally attach an `IntersectionObserver` for play/pause based on visibility.

## QA / verification
- Desktop
  - Video renders full-width behind the `ExperiencesSection` content, with text fully readable.
  - Section height remains content-driven (no full-screen takeover).
  - Autoplay starts muted, loops seamlessly, no controls visible, playback at ~0.5×.
  - Resizing window preserves coverage (`object-fit: cover`) without letterboxing.
- Mobile (iOS/Android)
  - Autoplay occurs with `muted` + `playsinline`; no fullscreen takeover.
  - Scrolling does not cause layout shifts; content remains interactive.
  - Reduced-motion devices do not autoplay (if implemented); content remains legible.
- Fallback
  - If media fails to load or is blocked, content and background color remain; no console errors breaking the page.

## Notes
- Use Tailwind utilities already present in the project for positioning (`relative`, `absolute`, `inset-0`), stacking (`z-` utilities), sizing, and `object-cover`.
- Do not introduce new dependencies; leverage existing `withBase` helper and Tailwind.
