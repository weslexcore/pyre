# PRD: Fix Table of Contents Mobile Navigation

## Introduction/Overview

The table of contents (TOC) component on the landing page blog posts navigates correctly to header sections on desktop, but on mobile devices the scroll positioning is incorrect - headers are being hidden behind the fixed navigation header. This PRD addresses fixing the mobile scroll behavior to match desktop functionality while maintaining the smooth scroll and accordion close behavior.

## Goals

1. Ensure TOC links on mobile scroll to the correct position with proper offset accounting for fixed headers
2. Maintain existing desktop functionality (working correctly)
3. Preserve smooth scrolling behavior on mobile
4. Maintain accordion auto-close behavior after navigation
5. Ensure consistent user experience across all device sizes

## User Stories

1. As a mobile blog reader, I want to click a TOC link and be scrolled to the correct section with the header fully visible, so that I can easily navigate the article content.

2. As a mobile user, I want the TOC accordion to close automatically after selecting a section, so that I have maximum screen space to read the content.

3. As a mobile user, I want smooth scrolling when navigating to sections, so that I have a polished reading experience similar to desktop.

## Functional Requirements

1. **FR-1**: When a user clicks a TOC link on mobile (viewport width < 1024px), the page must scroll to position the target header with proper offset to prevent it from being hidden behind fixed navigation elements.

2. **FR-2**: The scroll offset calculation on mobile must account for any fixed/sticky navigation headers, ensuring the target section header is visible at the top of the viewport.

3. **FR-3**: The existing smooth scroll behavior (enabled by `smoothScroll: true` in config) must work correctly on mobile.

4. **FR-4**: The mobile TOC accordion must close automatically after a user clicks a link (existing behavior at `TOCScrollTracker.tsx:140-142`).

5. **FR-5**: The fix must not affect desktop TOC navigation behavior, which is currently working correctly.

6. **FR-6**: The scroll offset value must be configurable via the `TOCConfig.scrollOffset` property (currently defaults to 100px in `toc-utils.ts:239`).

7. **FR-7**: After navigation completes, the active section indicator must update correctly to highlight the navigated section.

## Non-Goals (Out of Scope)

1. Changing the TOC UI/UX design or styling
2. Modifying the accordion animation timing or effects
3. Adding new TOC features beyond fixing the mobile navigation issue
4. Changing the desktop navigation behavior
5. Supporting browsers that don't support smooth scrolling
6. Modifying the header ID generation logic

## Design Considerations

- **Component Location**: `apps/landing-page/src/components/TableOfContents.astro` and `TOCScrollTracker.tsx`
- **Utility Functions**: `apps/landing-page/src/lib/toc-utils.ts` (specifically `scrollToHeader` function at lines 210-229)
- **Mobile Breakpoint**: Uses Tailwind's `lg` breakpoint (1024px) to differentiate mobile from desktop
- **Current Offset**: Default scroll offset is 100px (may need adjustment for mobile)
- No UI changes required - this is a scroll calculation fix

## Technical Considerations

1. **Root Cause**: The issue likely stems from:
   - Mobile viewport units calculating differently than desktop
   - Fixed navigation header not being properly accounted for in mobile scroll offset
   - Potential differences in how `window.scrollTo()` behaves on mobile browsers

2. **Investigation Areas**:
   - `navigateToSection()` method in `TOCScrollTracker.tsx:284-322`
   - `scrollToHeader()` utility function in `toc-utils.ts:210-229`
   - Mobile-specific scroll offset requirements (may need to be larger than 100px)

3. **Potential Solutions**:
   - Detect mobile viewport and apply different scroll offset
   - Calculate fixed header height dynamically and add to offset
   - Use `getBoundingClientRect()` differently for mobile
   - Check if mobile browsers require additional delay before scroll completes

4. **Browser Compatibility**: Must test on:
   - iOS Safari (most common mobile browser)
   - Chrome Mobile (Android)
   - Firefox Mobile

5. **Dependencies**:
   - No new dependencies required
   - Uses existing `window.scrollTo()` and `element.getBoundingClientRect()` APIs
   - Leverages existing intersection observer setup

## Success Metrics

1. **Primary Metric**: 100% of TOC link clicks on mobile (< 1024px viewport) scroll to position the target header visibly at the top of the viewport, not hidden behind fixed navigation.

2. **Functionality Verification**:
   - TOC navigation works correctly on iPhone/iPad Safari
   - TOC navigation works correctly on Android Chrome
   - Desktop navigation continues to work as before
   - Accordion closes after navigation on mobile

3. **User Experience**:
   - Smooth scroll animation completes within 500ms (existing timeout)
   - Active section highlighting updates correctly after navigation
   - No visible jumps or incorrect positioning after scroll completes

## Open Questions

1. **Q1**: What is the exact height of the fixed navigation header on mobile? Does it differ from desktop?
   - **Action**: Measure the fixed header height on mobile devices to determine correct offset value

2. **Q2**: Are there other fixed elements (like cookie banners, announcement bars) that should be accounted for in the scroll offset?
   - **Action**: Audit the page for all fixed/sticky positioned elements on mobile

3. **Q3**: Should the scroll offset be dynamically calculated based on actual fixed element heights, or use a static value?
   - **Recommendation**: Start with static value, iterate to dynamic if needed

4. **Q4**: Does the issue occur on all blog posts or only specific ones?
   - **Action**: Test across multiple blog posts to verify consistency

5. **Q5**: Is the issue related to the initial page load TOC behavior, or only after user interaction?
   - **Clarification Needed**: Current assumption is this affects user-initiated clicks only
