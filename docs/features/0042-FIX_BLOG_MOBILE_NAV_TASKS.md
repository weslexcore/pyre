## Relevant Files

- `apps/landing-page/src/components/Navbar.astro` (Modified) - Main navigation component with mobile menu implementation (reverted z-index change)
- `apps/landing-page/src/components/TableOfContents.astro` (Modified) - TOC component redesigned with mobile accordion instead of floating panel
- `apps/landing-page/src/components/TOCScrollTracker.tsx` (Modified) - Updated to handle accordion toggle instead of panel open/close
- `apps/landing-page/src/layouts/blog-post.astro` (Modified) - Blog post layout updated with accordion positioning and styling
- `apps/landing-page/src/layouts/main.astro` (Existing) - Main layout that includes the Navbar component

### Notes

- **Original Issue**: The issue was caused by z-index conflicts between the Navbar mobile menu and the TableOfContents backdrop/panel
- **Root Cause**: TableOfContents was using a floating panel with backdrop (z-30) that appeared above Navbar mobile menu (no z-index)
- **Solution Implemented**: Redesigned TableOfContents mobile view as an accordion section (no z-index, no floating elements, no backdrop)
  - Desktop: Maintains sticky sidebar implementation (unchanged)
  - Mobile: New accordion design that sits in the document flow under the blog header
- **Benefits**: Eliminates z-index conflicts entirely, improves mobile UX with clearer content hierarchy
- Manual testing required on mobile viewport for blog posts, homepage, and other pages

## Tasks

- [x] 1.0 Investigate and identify the root cause of the mobile navigation black screen on blog posts
  - [x] 1.1 Identified z-index conflict: TOC backdrop (z-30) appearing above Navbar mobile menu (no z-index)
  - [x] 1.2 Recognized that the TOC floating panel design was causing stacking context issues

- [x] 2.0 Redesign TableOfContents mobile implementation as an accordion
  - [x] 2.1 Removed floating panel, backdrop, and toggle button from mobile view
  - [x] 2.2 Implemented accordion component that sits in document flow under blog header
  - [x] 2.3 Updated TableOfContents.astro with new mobile accordion HTML structure
  - [x] 2.4 Removed all z-index values from mobile TOC elements
  - [x] 2.5 Maintained desktop sticky sidebar implementation (unchanged)

- [x] 3.0 Update TableOfContents JavaScript functionality
  - [x] 3.1 Updated TOCScrollTracker.tsx to handle accordion toggle instead of panel open/close
  - [x] 3.2 Removed backdrop click handlers and escape key handlers
  - [x] 3.3 Simplified mobile interaction to basic accordion expand/collapse
  - [x] 3.4 Maintained auto-close on link click behavior for mobile

- [x] 4.0 Update styles and layout
  - [x] 4.1 Updated blog-post.astro to position accordion properly under header
  - [x] 4.2 Added blog-specific styling for accordion toggle and content
  - [x] 4.3 Removed z-index related styles for mobile elements
  - [x] 4.4 Added accordion animation states and icon rotation

- [x] 5.0 Revert unnecessary changes
  - [x] 5.1 Reverted z-60 addition to Navbar mobile menu (no longer needed)
  - [x] 5.2 Navbar mobile menu returned to original implementation

- [x] 6.0 Format and validate code
  - [x] 6.1 Ran format command on landing page
  - [x] 6.2 Updated task documentation

- [x] 7.0 Position mobile accordion correctly
  - [x] 7.1 Moved TableOfContents component to render after meta info section in blog-post.astro
  - [x] 7.2 Mobile accordion now appears directly under author/date/reading time
  - [x] 7.3 Desktop sidebar remains fixed positioned on left side

**Implementation Summary:**
- Replaced floating TOC panel with in-flow accordion on mobile
- Eliminated all z-index conflicts by removing z-index from mobile TOC
- Mobile accordion positioned after author/date/reading time section
- Desktop experience unchanged (sticky sidebar maintained)
- Mobile UX improved with clearer content hierarchy
