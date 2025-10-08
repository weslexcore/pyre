## Relevant Files

- `apps/landing-page/src/components/TOCScrollTracker.tsx` (Modified) - Updated `navigateToSection()`, `setupIntersectionObserver()`, and `updateProgress()` to use dynamic scroll offset
- `apps/landing-page/src/lib/toc-utils.ts` (Modified) - Added `isMobileViewport()`, `getNavbarHeight()`, `calculateScrollOffset()` utilities; updated `scrollToHeader()` and `getCurrentActiveHeader()` to use dynamic offset
- `apps/landing-page/src/lib/toc-types.ts` (Existing) - Type definitions for TOC configuration (no changes needed - dynamic calculation preferred)
- `apps/landing-page/src/components/TableOfContents.astro` (Existing) - TOC component with mobile accordion (no changes needed)
- `apps/landing-page/src/layouts/blog-post.astro` (Existing) - Blog layout that sets scrollOffset configuration (no changes needed - dynamic calculation now used)
- `apps/landing-page/src/components/Navbar.astro` (Existing) - Fixed navigation header with `data-component="navbar"` attribute for height measurement

### Notes

- The mobile TOC uses an accordion pattern (visible on screens < 1024px)
- Desktop TOC is a fixed sidebar (visible on screens >= 1024px)
- The Navbar component is `fixed` at the top with height that varies (h-8 md:h-12 for logo)
- ~~Current scroll offset is 120px (set in blog-post.astro:111) but may need to be larger on mobile~~ **UPDATED**: Now uses dynamic calculation via `calculateScrollOffset()` function
- Use window.innerWidth or matchMedia to detect mobile viewport (< 1024px) - **IMPLEMENTED** in `isMobileViewport()` function
- Testing should be done on iOS Safari, Chrome Mobile, and Firefox Mobile per PRD requirements
- **Build Status**: Build passes with Node.js 22.18.0. Type-check has pre-existing errors unrelated to this implementation.

## Tasks

- [x] 1.0 Investigate and document mobile fixed header heights
  - [x] 1.1 Create a utility function to measure the actual height of the fixed navbar on mobile devices
  - [x] 1.2 Test navbar height measurement on different viewport sizes (mobile < 1024px, desktop >= 1024px)
  - [x] 1.3 Document the measured heights in code comments (expected: ~48-64px mobile, ~64-80px desktop based on h-8/h-12 classes)
  - [x] 1.4 Identify any other fixed/sticky elements on blog post pages that affect scroll offset (check blog-post.astro layout)
- [x] 2.0 Implement mobile-specific scroll offset detection
  - [x] 2.1 Add a utility function in `toc-utils.ts` to detect if viewport is mobile (< 1024px)
  - [x] 2.2 Add a utility function in `toc-utils.ts` to calculate dynamic scroll offset based on viewport size and fixed element heights
  - [x] 2.3 Update `TOCConfig` type in `toc-types.ts` to support mobile-specific offset (either add `mobileScrollOffset` property or make offset calculation dynamic)
  - [x] 2.4 Add configuration option in `blog-post.astro` for mobile scroll offset or enable dynamic calculation
- [x] 3.0 Update scroll navigation functions to use dynamic mobile offset
  - [x] 3.1 Update `scrollToHeader()` in `toc-utils.ts` to calculate offset dynamically based on viewport size
  - [x] 3.2 Update `navigateToSection()` in `TOCScrollTracker.tsx` to use dynamic offset for both smooth scroll and instant scroll paths
  - [x] 3.3 Update `getCurrentActiveHeader()` in `toc-utils.ts` to use correct offset for active section detection on mobile
  - [x] 3.4 Ensure intersection observer in `TOCScrollTracker.tsx` uses correct rootMargin for mobile viewports (line 60)
- [x] 4.0 Test and validate mobile navigation across devices
  - [x] 4.1 Upgrade Node.js to version 22 (required: >=18.20.8, current: 18.19.0)
  - [ ] 4.2 Manual Test: TOC navigation on mobile viewport (< 1024px) in Chrome DevTools device emulation
  - [ ] 4.3 Manual Test: Verify headers are fully visible (not hidden behind navbar) after clicking TOC links on mobile
  - [ ] 4.4 Manual Test: Verify accordion closes automatically after navigation on mobile
  - [ ] 4.5 Manual Test: Verify smooth scroll animation works correctly on mobile
  - [ ] 4.6 Manual Test: Verify active section highlighting updates correctly after mobile navigation
  - [ ] 4.7 Manual Test: Verify desktop navigation (>= 1024px) continues to work as before (regression test)
  - [ ] 4.8 Manual Test: Test on actual iOS Safari and Chrome Mobile if possible

### Manual Testing Instructions

To test the implementation locally:

1. Ensure Node.js 22 is active: `nvm use` or `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"`
2. Start dev server: `yarn dev:landing`
3. Navigate to any blog post (e.g., http://localhost:4321/blog/history-of-sweat-bathing/)
4. Open Chrome DevTools and toggle device toolbar (Cmd+Shift+M on Mac)
5. Select a mobile device (iPhone 12, Samsung Galaxy, etc.) to get viewport < 1024px
6. Test the following:
   - Click TOC items and verify headers appear below the navbar (not hidden)
   - Verify the mobile accordion closes after clicking a TOC link
   - Check smooth scrolling animation
   - Verify active section highlighting
7. Switch to desktop view (>= 1024px) and verify no regression
8. Test on actual mobile devices if available
