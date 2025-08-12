## Feature 0015 — Signup Form Focus and Center Enhancement

### Description
Enhance the existing signup form to center in the viewport and automatically focus the email input when navigated to via any CTA or link on the site. This reduces friction and improves accessibility for visitors ready to subscribe.

Verbatim requirements from brief:
- Centered sign-up form in the viewport when navigated to from a CTA (no off-screen or partial visibility)
- Automatic focus on the email input on arrival, with visible focus styles; selects existing text if present
- Works from all entry points: in-page anchors, cross-page links, and programmatic navigation
- Respects user preferences: avoid jarring scroll/animation when `prefers-reduced-motion` is set
- Accessibility: semantic labels, proper focus order; no layout shift for other content when not active
- Progressive enhancement: without JS the form still appears; with JS, centering and focus behavior are enhanced

### Relevant files and changes

#### `src/components/SignupForm.astro`
- **Centering logic**: Add conditional centering wrapper around the existing section that activates when URL contains `#signup` fragment or `?signup=1` query parameter
- **Container modification**: Wrap the existing section content in a conditional container that applies `min-h-screen flex items-center justify-center` when intent flag is detected
- **Default state preservation**: Maintain normal document flow when no intent flag is present to avoid layout shift
- **Accessibility preservation**: Keep existing `id="signup"`, `aria-labelledby`, and semantic structure intact
- **Motion respect**: Use CSS `@media (prefers-reduced-motion: reduce)` to disable smooth scrolling when user preference is set

#### Enhanced focus and selection behavior
- **Intent detection**: Add client script (using `client:load` or inline script) to detect URL fragment `#signup` or query parameter `?signup=1` on page load and after navigation
- **Focus management**: Call `emailInput.focus()` and `emailInput.select()` when intent is detected
- **Existing text selection**: Use `select()` method to highlight any pre-filled text in the email input
- **Progressive enhancement**: Ensure form remains functional without JavaScript
- **Error handling**: Wrap focus calls in try-catch blocks to handle edge cases gracefully

#### Entry point compatibility
- **Navbar CTA**: Existing `src/components/Navbar.astro` Button with `href="#signup"` will trigger centering behavior
- **Story section CTA**: Existing `src/components/StorySection.astro` Button with `href="#signup"` will trigger centering behavior  
- **Cross-page links**: Support for external links with fragment or query parameter (e.g., from other pages or email campaigns)
- **Programmatic navigation**: Support for JavaScript-driven navigation that updates URL with intent flags

### Implementation approach

#### Algorithm for centering detection
1. On component mount/page load, check for:
   - URL fragment equals `#signup`
   - OR URL search params contain `signup=1`
2. If intent detected:
   - Apply centering CSS classes to signup section wrapper
   - After DOM updates, focus and select email input
   - Respect `prefers-reduced-motion` for any scroll behavior
3. If no intent detected:
   - Render in normal document flow position

#### CSS implementation
- Use Tailwind utilities: `min-h-screen flex items-center justify-center` for centered state
- Apply conditional classes based on client-side intent detection
- Maintain responsive behavior across all breakpoints
- Ensure no layout shift occurs for users not targeting the signup form

#### Script requirements
- Lightweight inline script or Astro client directive
- Check URL on initial load and after any navigation events
- Handle both hash fragments and query parameters
- Graceful fallback if JavaScript is disabled
- Integration with existing form validation and submission scripts
