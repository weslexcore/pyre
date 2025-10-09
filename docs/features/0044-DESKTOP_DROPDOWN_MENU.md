# Desktop Dropdown Menu

## Introduction/Overview

Currently, the landing page features a mobile hamburger menu for smaller screens and inline navigation links for desktop. This PRD describes adding a desktop dropdown menu that provides a unified navigation experience across iPad and desktop devices. The dropdown will be triggered by a menu button in the top-right corner and will house all header navigation items plus an Instagram link, supplementing (not replacing) the existing desktop navigation links.

**Problem:** The current desktop navigation lacks a centralized menu option that could house additional links (like social media) and provide a consistent navigation pattern across device sizes.

**Goal:** Create a desktop-optimized dropdown menu that provides easy access to all navigation items and Instagram, with similar styling and animations to the existing mobile menu.

## Goals

1. Add a clickable menu button to the desktop header (iPad and above) in the top-right corner
2. Create a dropdown menu that displays all header navigation items plus Instagram link
3. Implement smooth slide-in animations matching the mobile menu experience
4. Ensure the dropdown supplements existing desktop navigation links (doesn't replace them)
5. Add Instagram link to both desktop dropdown and mobile menu
6. Maintain consistent styling between mobile and desktop menus while optimizing for larger screens

## User Stories

1. **As a desktop user**, I want to click a menu button in the header so that I can access all navigation options in one centralized location.

2. **As a desktop user**, I want the dropdown menu to slide in smoothly with animations so that the experience feels polished and matches the mobile menu behavior.

3. **As a desktop user**, I want the dropdown to close when I click outside of it so that I can easily dismiss it without finding a close button.

4. **As a desktop user**, I want the dropdown to close automatically when I click a link so that I'm not left with an open menu after navigation.

5. **As an iPad user**, I want to see the desktop dropdown menu (not the mobile menu) so that I have a navigation experience optimized for larger screens.

6. **As a user on any device**, I want to access the Instagram link from the navigation menu so that I can easily follow Pyre on social media.

## Functional Requirements

### Desktop Dropdown Menu

1. **FR-1:** The system must display a menu button (hamburger icon) in the top-right corner of the header when viewport width is ≥768px (iPad and desktop).

2. **FR-2:** The menu button must feature the same animated icon transition as the mobile menu (hamburger → close icon with rotation and scale animations).

3. **FR-3:** Clicking the menu button must toggle the dropdown menu open/closed with smooth slide-in animation.

4. **FR-4:** The dropdown menu must overlay page content (not push it down) and have a contained width (not full-width).

5. **FR-5:** The dropdown menu must include all items currently in `navbar.elements.links` plus `navbar.actions.primary` and `navbar.actions.secondary`.

6. **FR-6:** The dropdown menu must include a new Instagram social media link.

7. **FR-7:** The dropdown styling must match the mobile menu's background color, text color, border, and overall aesthetic.

8. **FR-8:** The dropdown must be positioned in the top-right corner, aligned with the menu button trigger.

9. **FR-9:** Clicking anywhere outside the dropdown menu must close it.

10. **FR-10:** Clicking any link within the dropdown menu must close the dropdown.

11. **FR-11:** The desktop dropdown must NOT replace existing inline desktop navigation links - both should coexist.

### Mobile Menu Enhancement

12. **FR-12:** The Instagram link must be added to the existing mobile menu.

### Configuration

13. **FR-13:** The Instagram link must be added to the `navbar.ts` configuration file following the "012-copy-configs" pattern.

14. **FR-14:** The Instagram link configuration must include label, href, and ariaLabel properties.

### Responsive Behavior

15. **FR-15:** The desktop dropdown menu must be visible when viewport width is ≥768px.

16. **FR-16:** The mobile menu must be visible when viewport width is <768px.

17. **FR-17:** The system must ensure only one menu version (mobile OR desktop dropdown) is visible at any given breakpoint.

## Non-Goals (Out of Scope)

1. Removing or replacing the existing inline desktop navigation links
2. Adding additional social media links beyond Instagram at this time
3. Creating a mega-menu or multi-column dropdown layout
4. Adding search functionality to the dropdown
5. Implementing keyboard navigation (arrow keys) for the dropdown menu items
6. Creating different dropdown styles for different pages

## Design Considerations

### Styling
- Use the same background color as mobile menu: `bg-black`
- Use the same border styling: `border-[var(--border)]`
- Use the same text and hover states as mobile menu buttons
- Dropdown should have a contained width (approximately 250-300px)
- Use similar padding and spacing as mobile menu

### Animation
- Slide-in animation: `transition-all duration-300 ease-in-out`
- Opacity fade: transition from `opacity-0` to `opacity-100`
- Height transition using max-height technique (similar to mobile menu)
- Menu button icon rotation and scale animation (identical to mobile menu)

### Positioning
- Fixed or absolute positioning in top-right corner
- Align right edge of dropdown with right edge of menu button
- Add appropriate top offset to position below the header
- Consider z-index layering to ensure dropdown appears above page content

### Accessibility
- Include proper ARIA labels for menu button: `aria-label="Toggle desktop menu"`
- Include `aria-expanded` attribute that updates based on open/closed state
- Include `aria-controls` attribute linking button to dropdown menu element
- Ensure proper focus management when dropdown opens/closes

## Technical Considerations

### Implementation Approach
1. Duplicate and adapt the existing mobile menu button and menu structure in `Navbar.astro`
2. Use Tailwind's responsive classes to show/hide appropriate menu version (`md:hidden` for mobile, `hidden md:flex` for desktop dropdown)
3. Extend the existing inline script in `Navbar.astro` to handle desktop dropdown interactions
4. Create separate event listeners for desktop dropdown vs mobile menu to avoid conflicts
5. Update `navbar.ts` to include Instagram link in a social media section or within existing structure

### Dependencies
- No new packages required
- Leverages existing Tailwind CSS classes and Astro component structure
- Uses existing Button component for dropdown menu items

### Files to Modify
- `/apps/landing-page/src/components/Navbar.astro` - Add desktop dropdown markup and JavaScript
- `/apps/landing-page/src/lib/navbar.ts` - Add Instagram link configuration
- Potentially `/apps/landing-page/src/lib/types.ts` - Update NavbarContent type if needed for social links

### Instagram Link
- URL: `https://www.instagram.com/pyresauna/` (or as specified in requirements)
- Should open in new tab (`target="_blank"` with `rel="noopener noreferrer"`)
- Icon: Consider using an Instagram SVG icon or text label

## Success Metrics

1. **Usability:** Users on desktop/iPad can successfully access all navigation items through the dropdown menu
2. **Engagement:** Instagram link clicks are trackable and show user engagement with social media
3. **Visual Consistency:** Design review confirms desktop dropdown matches mobile menu styling
4. **Performance:** Dropdown animations are smooth (60fps) with no janky behavior
5. **Accessibility:** All interactive elements pass ARIA attribute validation
6. **Cross-browser:** Dropdown functions correctly in Chrome, Firefox, Safari, and Edge (latest versions)

## Open Questions

1. Should the Instagram link be represented with an icon, text label, or both?
2. What is the exact Instagram handle/URL to use?
3. Should the desktop dropdown appear only when the menu button is clicked, or should we also consider keeping the existing inline nav links visible alongside it?
   - **Resolution:** Dropdown supplements existing inline links (both visible)
4. At exactly which breakpoint should we switch from mobile to desktop dropdown? (Currently defined as 768px/md breakpoint)
5. Should the dropdown have a backdrop/overlay that darkens the page content when open?
6. Should we add any additional social media links in the future? (Future consideration, not in scope for this PRD)
