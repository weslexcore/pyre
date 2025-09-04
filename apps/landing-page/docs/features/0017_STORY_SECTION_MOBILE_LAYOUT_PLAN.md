## 0017 — Story Section Mobile Layout — Plan

### Context
Adjust the Story section layout specifically for mobile to improve readability and visual balance. The changes include: "Center the symbol within the image on mobile," "Remove the left text gutter on mobile to allow the story text to align naturally and use available width," and "Add padding above the image on mobile to create clear separation from preceding text." Preserve current tablet/desktop layouts; changes apply only to mobile breakpoints.

### Scope and target files
- Edit: `src/components/StorySection.astro`
- No new components or global utilities expected; `src/styles/global.css` remains unchanged.

### Current structure summary (for reference)
- Section uses a single-column grid on mobile and a 12-column grid from `md` up.
- The image is the first grid item; the text block is second on mobile.
- The symbol (blue circular badge containing `/symbols/sauna-symbol.png`) currently sits inside the text block, aligned left of the heading within a flex row.

### Mobile-only layout changes
- Center the symbol within the image on mobile:
  - Move the symbol into the image container as a mobile-only overlay element centered both horizontally and vertically within the image.
  - Keep the current symbol inside the text block visible from `md` and up only.
  - Ensure the image container is relatively positioned so the symbol overlay can be absolutely centered without affecting image flow.

- Remove the left text gutter on mobile:
  - On mobile, remove the two-column flex row inside the text block that reserves space for the symbol.
  - Stack the heading and body copy vertically with no leading icon column so text uses the available width naturally.
  - Preserve existing text sizing and spacing; do not introduce additional left padding beyond the section container padding.

- Add padding above the image on mobile:
  - Reorder the grid items on mobile so the text renders before the image, then add top padding on the image block to create clear separation from the preceding text.
  - Preserve the current visual order on tablet/desktop.

### Responsive behavior rules
- All changes apply only to mobile (below `md`).
- Use responsive utilities to:
  - Hide the in-text symbol on mobile; show it from `md` and up.
  - Show the centered overlay symbol only on mobile; hide it from `md` and up.
  - Swap the visual order of text and image on mobile; reset to original order from `md` and up.
  - Add mobile-only top padding above the image block.

### Detailed implementation steps
1. In `src/components/StorySection.astro`, within the image container:
   - Ensure the wrapper is relatively positioned.
   - Add a mobile-only overlay element containing the symbol image; position it centered within the image area.
   - Hide this overlay at `md` and above.

2. In the text block wrapper:
   - Hide the existing symbol element on mobile; show it from `md` and up so tablet/desktop remain unchanged.
   - On mobile, remove the left-gutter layout created by the symbol/text flex row by stacking heading and copy vertically (no leading icon column).

3. Reorder and space on mobile:
   - On mobile, render the text block before the image block.
   - Add a mobile-only top padding to the image block to provide separation from the preceding text.
   - At `md` and up, revert to the current order (image left, text right) with no extra padding added by the mobile rule.

4. Verify no regressions:
   - Check that tablet/desktop breakpoints (`md` and above) are unchanged visually.
   - Confirm the CTA, analytics event wiring, and focus behavior in the section script remain intact.

### Test/validation
- View on iOS Safari/Chrome and Android Chrome at common widths (e.g., 320–430 px):
  - Symbol is centered within the image on mobile.
  - Story text shows no residual left gutter and uses available width naturally.
  - There is clear padding above the image when it follows the text on mobile.
  - Tablet/desktop layouts match current production visuals.


