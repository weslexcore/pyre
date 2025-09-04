### Feature 0029 — Signup Form Desktop Alignment Plan

Brief: Ensure that on desktop breakpoints, the email text input and submit button in the sign‑up form are perfectly aligned on the same baseline/height. The button currently sits a few pixels lower; this fix delivers a crisp, consistent horizontal alignment without changing mobile behavior. Preserve accessibility, focus styles, and cross-browser consistency.

#### Relevant files
- `src/components/SignupForm.astro` — primary layout and Tailwind utility classes for the form, label, input, error, and submit button
- `src/components/Button.astro` — shared button variants and sizes; may receive a non-breaking, optional class from the caller for fixed height at desktop
- `src/styles/global.css` — focus outlines already standardized; optionally add a small utility for shared control height if needed (Tailwind-first)
- `src/lib/signupForm.ts` — copy only; no changes expected

#### Current state summary
- Form container: `form` uses `flex`, `flex-col`, switches to `sm:flex-row`. No vertical alignment utility is applied at desktop, and the submit button wrapper uses `sm:self-end`, which contributes to misalignment relative to the input control.
- Input: `px-3 py-2` with `rounded-md` and `border` (1px). No explicit fixed height. Label is rendered above the input inside the same flex item, increasing the item’s height and complicating cross-axis alignment with the button item.
- Button: Provided by `Button.astro` with size paddings (e.g., `py-2`) and no fixed height by default. Accepts an extra class from the caller.

#### Goals (restate key brief requirements)
- Desktop: input and button must have the same visual height and be aligned horizontally on the same baseline.
- Mobile: preserve existing stacked layout and spacing.
- Accessibility: maintain label semantics and focus outlines. Avoid focus styles affecting computed control height.
- Cross-browser: consistent in Chrome, Safari, Firefox.

#### Plan of changes (Tailwind-first)
1) `src/components/SignupForm.astro` — form layout alignment at desktop
   - On the `form` element, at `md:` and above, add a vertical alignment utility to align the control row (e.g., `md:items-center`). Keep mobile unchanged.
   - Remove `sm:self-end` from the button wrapper. This local override pushes the button to the bottom of the taller input+label column. Replace with normal alignment (inherit from `items-center`) so controls align naturally.

2) `src/components/SignupForm.astro` — normalize control heights at desktop
   - Apply a shared fixed height on both the input and the button at `md:` and above (e.g., `md:h-12`).
   - For the input: keep `px` padding; with Tailwind’s border-box preflight, `h-12` will include padding and border for consistent total height.
   - For the button: pass an extra class from the caller (e.g., `class="md:h-12"`) so the rendered `<button>` receives the same fixed height without changing `Button.astro` API.
   - Ensure both controls share consistent `rounded` and `border` widths (input is `rounded-md` with 1px border; primary button has no border which is fine—borders should not alter computed height due to fixed `h-*`).

3) `src/components/SignupForm.astro` — mitigate label-induced height mismatch at desktop
   - Keep the visible label on mobile.
   - At `md:` and above, make the label visually hidden while remaining accessible (use a screen-reader-only utility) so the input’s flex item height collapses to the control height and aligns with the button’s height.
   - Maintain `aria` and `for`/`id` associations.

4) Optional utility (only if needed)
   - If a single utility is preferred for reuse, add a `.form-control-md` class in `src/styles/global.css` that applies `@apply md:h-12 md:text-base;`, and use it on both input and the button (via `class` on the `Button` component). Default to inline utilities first; only introduce this if duplication becomes problematic.

5) Do not change `Button.astro` sizing scale in this iteration
   - Avoid touching `Button.astro` paddings/variants. The fixed height class from the caller is sufficient and non-breaking.

#### Step-by-step algorithm
1. Update `form` classes in `SignupForm.astro`:
   - Add `md:items-center` (or `sm:items-center`, if we want alignment to apply starting at `sm`), keeping `flex-col` on mobile.
   - Remove the `sm:self-end` on the button wrapper; ensure wrapper uses default alignment.
2. Update input control in `SignupForm.astro`:
   - Add `text-base` and `md:h-12` to the `<input>` so font size and total height match the button.
   - Keep existing `px-3 py-2`, `rounded-md`, and `border`.
3. Update button usage in `SignupForm.astro`:
   - Pass `class="md:h-12"` to `<Button ...>` to enforce identical height at desktop.
   - Keep `variant="primary"` and `size="md"` as-is.
4. Update label visibility rule in `SignupForm.astro`:
   - Apply a screen-reader-only utility at `md:` and above to the `<label>` so it doesn’t affect the control row height at desktop while remaining accessible (e.g., `md:sr-only`).
5. Verify spacing between input and button at desktop:
   - Keep horizontal gap (`gap-x-*` through `gap-*` on the `form`) consistent with existing design scale.

#### Edge cases / QA checklist
- Mobile (xs/sm): layout remains stacked; the label is visible as today.
- Desktop (md+): input and button heights are equal; vertical alignment is crisp; no overlap with focus outlines.
- Focus states: outline does not alter size (outline doesn’t affect layout; `outline-offset` is already set globally).
- Error message: appearing text under input should not shift button baseline; alignment is between the two controls themselves.
- Copy length: long submit label should wrap or truncate consistently; ensure fixed height with `inline-flex items-center` on the button keeps label vertically centered.
- Browser checks: Chrome, Safari, Firefox on macOS; verify no UA-specific default paddings alter height.

#### No data/API changes
- No type or API updates; copy-only file `src/lib/signupForm.ts` remains unchanged.

#### Rollout
- Implement changes behind no flags; visual tweak only.
- Manually verify across breakpoints and browsers.


