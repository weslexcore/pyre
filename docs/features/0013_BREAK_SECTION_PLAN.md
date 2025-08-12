### Feature: Break Section between EXPERIENCES and SIGN UP (0013)

Concise technical plan to add a visually calming “break” section on the homepage placed between the EXPERIENCES section and the SIGN UP section. The section features a large quote with a rotating word inside the sentence “PYRE IS A SPACE TO ____________”, a low‑opacity background image, and a CTA button “SPEND TIME WITH US” that routes to the mailing list signup.

### Scope and placement
- Insert new section between `ExperiencesSection` and `SignupForm` on the homepage `src/pages/index.astro`.
- Background image: `public/images/giant_clouds.jpeg` rendered visually at ~0.2 opacity with an overlay to ensure contrast/readability.
- Rotating word sequence for the quote: [blank], RECONNECT, DISCONNECT, MAKE A FRIEND, BREATHE, HEAL.
- CTA button text: “SPEND TIME WITH US” linking to the existing signup section anchor `#signup` (present on `<section id="signup">` in `src/components/SignupForm.astro`).

### Files to create or modify
- Create: `src/components/BreakSection.astro`
  - Exports a self‑contained section component with:
    - Background image layer and contrast overlay
    - Large typographic quote: “PYRE IS A SPACE TO [rotating-word]”
    - CTA button using existing `src/components/Button.astro`
    - Lightweight client script for word rotation, accessibility hooks, and reduced‑motion handling
    - Optional props (with sensible defaults) for: `words`, `intervalMs`, and `ctaHref`
- Modify: `src/pages/index.astro`
  - Import `BreakSection` and insert it after `<ExperiencesSection />` and before `<SignupForm />`.
- Read‑only reference: `src/components/SignupForm.astro`
  - Confirms `id="signup"` exists for the CTA anchor target.
- Read‑only reference: `src/styles/global.css`
  - Confirms smooth scrolling and design tokens; no required changes.

### Content and layout details
- Structure in `BreakSection.astro`:
  - Wrapper `<section aria-labelledby="break-heading">` with a container establishing relative positioning.
  - Absolutely positioned background image layer (using `/images/giant_clouds.jpeg`) with Tailwind utilities and `loading="lazy"`/`decoding="async"` for performance. Overlay via an additional absolutely positioned element (e.g., semi‑transparent dark layer) to achieve ~0.2 visual opacity while preserving asset integrity.
  - Foreground content container centered with generous vertical padding.
  - Heading markup:
    - Visually large, semantic heading element with brand typography utilities (e.g., `font-primary-semibold`, uppercase, tight tracking). Size aligns with other section heads (consider `text-[clamp(2rem,6vw,4.618rem)]` scale).
    - Sentence text: “PYRE IS A SPACE TO ” followed by a rotating word span.
    - Rotating word span is contained within an inline element (e.g., `<span>`) with `aria-live="polite"` and `aria-atomic="true"` for minimal updates when the word changes.
  - CTA below the heading: use `Button` component with `variant="primary"` and copy “SPEND TIME WITH US”, `href="#signup"`.
  - Color/contrast: ensure sufficient contrast of text over image using overlay and brand tokens (`var(--pyre-creme)`, `var(--pyre-black)` as needed).

### Word rotation algorithm (step-by-step)
1. Define list of words exactly as specified: `["", "RECONNECT", "DISCONNECT", "MAKE A FRIEND", "BREATHE", "HEAL"]` where the empty string represents the blank state in “PYRE IS A SPACE TO ____________”.
2. Define `intervalMs = 3000` (3 seconds) for cycling.
3. On component hydration, check `window.matchMedia('(prefers-reduced-motion: reduce)')`:
   - If true, do not animate; display the first state (blank) and keep the word static.
4. Otherwise, start an interval that increments an index modulo `words.length`, updating the `textContent` of the rotating span on each tick.
5. Use `document.visibilityState` to pause rotation when the tab is not visible:
   - On `visibilitychange`: if `document.hidden`, clear the interval; when visible again, resume from the last index.
6. Set `aria-live="polite"` on the word container to announce updates without being intrusive. Use `aria-atomic="true"` to ensure full word announcements.
7. On page teardown (e.g., `beforeunload`), clear the interval to avoid leaks.
8. Progressive enhancement: if JavaScript is disabled or fails, the sentence displays with the first word (blank) as static text.

### Accessibility
- Heading semantics: ensure a logical level relative to surrounding sections (likely an `h2`).
- `aria-live="polite"` and `aria-atomic="true"` on the rotating word container.
- Respect `prefers-reduced-motion` to disable rotation.
- Maintain contrast ratio against the overlaid image, especially for light/dark modes if present (brand tokens already defined in CSS variables).

### Responsiveness and performance
- Mobile‑first layout; constrain max text width for readability (e.g., `max-w-[75ch]`).
- Use responsive padding and font sizes via Tailwind fluid sizes.
- Background image as an absolutely positioned `<img>` with `object-cover` and `loading="lazy"`, `decoding="async"`.
- Keep client script minimal and self‑contained; no external deps.

### Integration specifics (no code, implementation notes)
- `src/components/BreakSection.astro` imports:
  - Import `Button` from `src/components/Button.astro` for CTA.
  - No other new dependencies required.
- Insert in `src/pages/index.astro`:
  - Add `import BreakSection from "../components/BreakSection.astro"`.
  - Place `<BreakSection />` after `<ExperiencesSection />` and before `<SignupForm />`.
- CTA destination uses existing `#signup` anchor on the same page; smooth scrolling is already enabled in `src/styles/global.css`.

### Phases
- Phase 1 — Structure and styling
  - Create `BreakSection.astro` with static content (no rotation), background image, overlay, typography, and CTA linking to `#signup`.
  - Insert into homepage and verify placement and contrast across breakpoints.
- Phase 2 — Interaction and accessibility polish
  - Add rotating word script with reduced‑motion and visibility pause/resume behavior.
  - Add `aria-live` attributes and verify screen reader announcements are not disruptive.
  - Validate keyboard focus order and CTA focus styles.

### Risks and mitigations
- Text contrast over image: mitigate via overlay and testing across devices.
- Motion sensitivity: respect reduced‑motion; keep updates infrequent (3s) and non‑animated text swaps.
- Layout shifts: ensure fixed container heights/padding; background image is absolutely positioned to avoid content reflow.

### Acceptance checks
- The new section appears between EXPERIENCES and SIGN UP on `src/pages/index.astro`.
- The background uses `public/images/giant_clouds.jpeg` at a visually subtle (~0.2) opacity with clear, readable text.
- The sentence “PYRE IS A SPACE TO ____________” shows the rotating word sequence: [blank], RECONNECT, DISCONNECT, MAKE A FRIEND, BREATHE, HEAL.
- The CTA “SPEND TIME WITH US” scrolls to the existing signup section (`#signup`).
- Reduced‑motion users see a static sentence without rotation; screen readers receive polite updates only when rotation is active.


