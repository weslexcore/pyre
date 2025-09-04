### Website Footer – Technical Plan (0014)

#### Brief description
Implement a site‑wide footer using the brand repeating pattern and color system. The footer must include hours, location, email `hi@pyresauna.com`, a link to Instagram, and the full logo. Background should use `public/logos/repeating_background.png` with a `--pyre-black` overlay to ensure readable contrast. Must be responsive (stacked on small screens; multi‑column on larger) and accessible (WCAG AA, landmarks, focus, alt text).

#### Files to create/update
- New: `src/components/Footer.astro`
- Update: `src/layouts/main.astro` – import and render `<Footer />` so it appears site‑wide
- Optional (only if needed): `src/styles/global.css` – leverage existing `.bg-repeating-logo` helper; no required changes anticipated

#### Data and assets
- Email: `hi@pyresauna.com` (mailto link)
- Instagram: external link (confirm final handle; default to `https://instagram.com/pyresauna` if unconfirmed). Opens in new tab with `rel="noopener noreferrer"` and accessible label
- Brand mark: use existing asset from `public/logos/creme/logo.png` or equivalent (e.g. `logo_with_text.png` or `full_logo_text_with_subtitle.png`). Provide descriptive `alt` (e.g., "Pyre Sauna + Cold Plunge logo")
- Background: `public/logos/repeating_background.png` (already exposed at `/logos/repeating_background.png`)

#### Component structure (semantic and responsive)
- Root element: `<footer role="contentinfo">`
- Wrapper: full‑width container with repeating brand background plus dark overlay using `--pyre-black` to achieve AA contrast for text and icons
- Inner layout: centered content container using existing page max‑width conventions (`sm/md/lg/xl` breakpoints)
- Content blocks:
  - Brand block: full logo image and brief brand line (optional) for context
  - Hours: show text "Coming Soon"
  - Location: show text "Coming Soon"
  - Contact: `mailto:hi@pyresauna.com`
  - Social: Instagram link with recognizable icon (inline SVG) and visible text label
- Responsive behavior:
  - Mobile (default): stacked vertical layout with generous spacing
  - `md+`: multi‑column grid (e.g., 3 or 4 columns) where brand occupies first column and info groups occupy remaining columns

- Extract footer content (email, social links, hours/location) into a small config in `src/lib/` for easier updates
- Add structured data (e.g., `Organization` with `sameAs` for Instagram) at the layout level later

#### Styling approach
- Tailwind first; reuse existing theme variables in `:root` from `global.css`:
  - Foreground text: ensure contrast vs. overlay. Prefer text using `--pyre-creme` over `--pyre-black` background tint
  - Background pattern: either
    - Use existing `.bg-repeating-logo` utility on the wrapper and add a semi‑transparent overlay using a positioned element, or
    - Use a layered background with a linear‑gradient overlay + image (Tailwind arbitrary value for `background-image`)
- Spacing and rhythm: align with existing container paddings used by `Navbar.astro` and `index.astro`
- Focus styles: rely on global focus ring from `global.css`

#### Accessibility
- Landmarks: `<footer role="contentinfo">`
- Images: meaningful `alt` text on logo; decorative icons have `aria-hidden="true"` if paired with text
- Links: clear names (e.g., "Instagram"), `aria-label` as needed (e.g., "Pyre Sauna on Instagram")
- Keyboard: visible focus states; tab order follows visual order
- Contrast: verify AA for text over the tinted background; increase overlay opacity if needed

#### Integration steps
1. Create `src/components/Footer.astro` with the structure above (no dynamic data required initially)
2. Add responsive layout classes for stacked → multi‑column behavior
3. Apply background pattern and `--pyre-black` overlay; set text color to ensure AA contrast
4. Create config and structured data
5. Wire up links: `mailto:hi@pyresauna.com` and Instagram (new tab with `rel="noopener noreferrer"`)
6. Import and render `<Footer />` in `src/layouts/main.astro` below the page `<slot />` so it appears on all pages

#### Notes on implementation details (no code)
- Prefer `img` for the logo with width/height attributes, `decoding="async"`, and `loading="lazy"`
- Instagram icon can be an inline SVG (no new dependency)
- Keep copy minimal; use short labels for sections

#### QA checklist
- Footer renders across all pages and does not overlap content
- Mobile: stacked layout; Desktop: multi‑column layout with consistent spacing
- All links are accessible via keyboard, have visible focus, and function correctly
- Contrast meets WCAG AA over the patterned background
- Alt text on logo is descriptive; decorative icons hidden from AT
- External link opens in new tab with proper `rel` attributes
