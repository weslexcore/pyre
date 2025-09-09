### 1. Project overview / description
Ensure that when a visitor opens the sign‑up form via any button or link on the site, the form is centered in the viewport and the email input is automatically focused/selected, reducing friction and improving accessibility.

### 2. Target audience
- Visitors ready to subscribe for updates or offers
- Mobile‑first users
- Keyboard‑only and screen‑reader users

### 3. Primary benefits / features
- Centered sign‑up form in the viewport when navigated to from a CTA (no off‑screen or partial visibility)
- Automatic focus on the email input on arrival, with visible focus styles; selects existing text if present
- Works from all entry points: in‑page anchors, cross‑page links, and programmatic navigation
- Respects user preferences: avoid jarring scroll/animation when `prefers-reduced-motion` is set
- Accessibility: semantic labels, proper focus order; no layout shift for other content when not active
- Responsive across breakpoints

### 4. High-level tech/architecture used
- Component: enhance existing `src/components/SignupForm.astro` (keep a stable `id`, e.g., `signup`)
- Triggering: use URL fragment `#signup` or a query flag (e.g., `?signup=1`) added by CTAs to indicate intent
- Centering: Tailwind CSS first; apply a conditional "centered" container state using `min-h-screen` + `flex items-center justify-center` when intent flag is present; default to normal flow otherwise
- Focusing: small client script (Astro `client:load` or `client:idle`) to detect the intent (fragment/query) and call `emailInput.focus()` and `emailInput.select()`; also handle when the form is dynamically revealed
- Progressive enhancement: without JS the form still appears; with JS, centering and focus behavior are enhanced
- Testing: validate on mobile and desktop, keyboard‑only navigation, and with screen readers


