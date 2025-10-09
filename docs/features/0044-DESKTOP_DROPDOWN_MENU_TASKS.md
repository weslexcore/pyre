## Relevant Files

- `apps/landing-page/src/lib/navbar.ts` (Existing) - Add Instagram social link configuration
- `apps/landing-page/src/lib/types.ts` (Existing) - Update NavbarContent type to support social links if needed
- `apps/landing-page/src/components/Navbar.astro` (Existing) - Add desktop dropdown menu markup, mobile Instagram link, and JavaScript event handlers

### Notes

- No unit tests required for this feature (Astro component with inline JavaScript)
- Manual testing across breakpoints (mobile <768px, desktop ≥768px) required
- Test in Chrome, Firefox, Safari, and Edge (latest versions)
- Verify ARIA attributes and accessibility with keyboard navigation

## Tasks

- [x] 1.0 Update navbar configuration to include Instagram social link
  - [x] 1.1 Add Instagram link object to `navbar.ts` in a new `social` property under `actions` with label, href (`https://www.instagram.com/pyresauna/`), and ariaLabel
  - [x] 1.2 Update `NavbarContent` type in `types.ts` to include optional `social` property with Instagram link structure if not already supported by existing `actions` structure
  - [x] 1.3 Verify Instagram link opens in new tab by including target and rel attributes in Button component usage

- [x] 2.0 Implement desktop dropdown menu UI structure in Navbar.astro
  - [x] 2.1 Add desktop menu button (hamburger icon) in header after existing desktop navigation links, visible only on `md:` breakpoint and above (use `hidden md:inline-flex` classes)
  - [x] 2.2 Create desktop menu button with same SVG icons (hamburger and close) as mobile menu button, with unique IDs (`desktop-menu-button`, `desktop-hamburger-icon`, `desktop-close-icon`)
  - [x] 2.3 Add ARIA attributes to desktop menu button: `aria-label="Toggle desktop menu"`, `aria-expanded="false"`, `aria-controls="desktop-dropdown"`
  - [x] 2.4 Create desktop dropdown menu container (`<nav id="desktop-dropdown">`) with absolute positioning, top-right alignment, contained width (w-64 or w-72), and hidden by default
  - [x] 2.5 Add dropdown menu styling: `bg-black`, `border border-[var(--border)]`, `rounded-md`, `shadow-lg` to match mobile menu aesthetic
  - [x] 2.6 Populate dropdown with all navbar.elements.links, navbar.actions.secondary, navbar.actions.primary, and navbar.actions.social.instagram using Button components
  - [x] 2.7 Add transition classes for slide-in animation: `transition-all duration-300 ease-in-out`, opacity (`opacity-0` to `opacity-100`), and transform (`translate-y-[-10px]` to `translate-y-0`)
  - [x] 2.8 Ensure dropdown is visible only on `md:` breakpoint and above (use responsive visibility classes)

- [x] 3.0 Add desktop dropdown menu JavaScript functionality and event handlers
  - [x] 3.1 Create `setupDesktopDropdown()` function in inline script similar to existing `setupMobileMenu()` function
  - [x] 3.2 Add click event listener to desktop menu button to toggle dropdown open/closed state
  - [x] 3.3 Implement toggle function that updates `aria-expanded` attribute and toggles dropdown visibility classes (opacity, transform, max-height if needed)
  - [x] 3.4 Add icon transition animations when toggling: hamburger icon fade/rotate out, close icon fade/rotate in (same pattern as mobile menu)
  - [x] 3.5 Add click-outside event listener to close dropdown when user clicks anywhere outside dropdown or menu button
  - [x] 3.6 Add event listeners to all dropdown links to close dropdown when clicked
  - [x] 3.7 Call `setupDesktopDropdown()` from main `setup()` function to initialize on page load

- [x] 4.0 Add Instagram link to existing mobile menu
  - [x] 4.1 Add Instagram Button component to mobile menu nav section in Navbar.astro using `navbar.actions.social.instagram` configuration
  - [x] 4.2 Position Instagram link at the end of mobile menu items (after primary and secondary actions)
  - [x] 4.3 Apply same Button styling as other mobile menu items: `w-full`, appropriate variant, and size

- [x] 5.0 Test responsive behavior and accessibility across all breakpoints
  - [x] 5.1 Test mobile menu (<768px) displays correctly and Instagram link is present
  - [x] 5.2 Test desktop dropdown (≥768px) displays correctly with menu button in top-right and all nav items present
  - [x] 5.3 Verify only one menu version is visible at each breakpoint (mobile OR desktop dropdown, never both)
  - [x] 5.4 Test dropdown animations are smooth (slide-in, fade, icon transitions) in all browsers
  - [x] 5.5 Test click-outside functionality closes dropdown on desktop
  - [x] 5.6 Test clicking dropdown links closes dropdown and navigates correctly
  - [x] 5.7 Verify all ARIA attributes update correctly (aria-expanded toggles between true/false)
  - [x] 5.8 Test Instagram link opens in new tab with proper security attributes (target="_blank" rel="noopener noreferrer")
  - [x] 5.9 Test across Chrome, Firefox, Safari, and Edge (latest versions) for cross-browser compatibility
  - [x] 5.10 Verify existing inline desktop navigation links still work and are not replaced by dropdown
