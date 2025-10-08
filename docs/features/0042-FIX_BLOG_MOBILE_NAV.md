# PRD: Fix Blog Post Mobile Navigation Menu

## Introduction/Overview

The mobile navigation menu on blog post pages displays as a black, empty screen instead of showing the standard mobile dropdown menu. This bug prevents users from easily navigating away from blog posts on mobile devices, creating a poor user experience. The goal is to ensure blog posts use the same functional mobile navigation dropdown that works correctly on all other pages of the site.

## Goals

1. Fix the mobile navigation menu on blog post pages to display the same functional dropdown menu used across the rest of the site
2. Ensure users can access navigation options when viewing blog posts on mobile devices
3. Maintain consistency in mobile navigation behavior across all pages

## User Stories

1. As a mobile user reading a blog post, I want to open the navigation menu so that I can navigate to other sections of the site without issues
2. As a mobile user, I want the blog post navigation to look and work the same as navigation on other pages so that the experience is consistent
3. As a mobile user, I want to be able to close the navigation menu easily by clicking outside of it or using standard controls

## Functional Requirements

1. The system must render the same mobile navigation dropdown on blog post pages that is used on other pages (homepage, tools, etc.)
2. The mobile navigation menu must display navigation items (not a black/empty screen) when opened on blog post pages
3. The mobile navigation menu must be closable by clicking outside the menu area
4. The mobile navigation menu must maintain the same styling and layout as the navigation on non-blog pages
5. The mobile navigation menu must function correctly across all blog posts, not just specific ones

## Non-Goals (Out of Scope)

1. Adding blog-specific navigation items or features
2. Redesigning the mobile navigation component
3. Improving navigation on desktop/tablet views
4. Implementing additional navigation improvements beyond fixing the rendering issue
5. Making the blog navigation different or special compared to other pages

## Design Considerations

- The mobile navigation should be visually identical to the existing mobile dropdown used on other pages
- No design changes are required - this is purely a bug fix to restore existing functionality
- The fix should not introduce any visual regressions on other pages

## Technical Considerations

- Investigation needed to determine why blog posts render the navigation differently
- Blog posts may use a different layout component or have conflicting CSS/JavaScript
- The existing Navbar component (apps/landing-page/src/components/Navbar.astro) should be reviewed
- Check for layout-specific overrides or missing component imports in blog post templates
- Ensure any blog-specific layouts import and render the Navbar component correctly

## Success Metrics

1. Mobile navigation menu displays correctly (shows menu items, not black screen) on all blog post pages
2. Users can successfully open and close the mobile navigation on blog posts
3. Navigation behavior on blog posts matches navigation behavior on other pages
4. No regressions introduced to navigation on other pages

## Open Questions

1. Are there multiple blog post layouts/templates that need to be fixed, or just one?
2. Is the black screen caused by missing styles, missing component imports, or JavaScript errors?
3. Should we add automated tests to prevent this regression in the future?
