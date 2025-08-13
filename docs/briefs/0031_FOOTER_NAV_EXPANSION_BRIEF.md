### 1. Project overview / description
Expand the site footer navigation to include grouped links for Press, Support, Company, and Legal. Add a mailto action for press inquiries and placeholders for future pages (to be implemented separately) such as Contact, Mission, FAQs, Health & Safety, and legal policies.

### 2. Target audience
- Visitors and journalists seeking press contact
- Prospective and current guests needing help or policy info
- Users looking for company background and mission

### 3. Primary benefits / features
- **Clear grouping**: Organize items for quick scan and discoverability.
  - Press: "Press & News" → opens email composer to `press@pyresauna.com` (mailto link)
  - Support: "Contact Us" (form page), "FAQs", "Health & Safety"
  - Company: "Our Mission"
  - Legal: "Privacy Policy", "Cookie Policy", "Terms of Service"
- **Consistent UX**: Internal pages open in the same tab; mailto launches default email app with sensible subject line; external links (if any) open in a new tab.
- **Responsive layout**: Stacked groups on mobile; multi-column on larger screens.
- **Accessible labeling**: Descriptive link text, visible focus states, adequate contrast.

### 4. High-level tech/architecture used
- **Content source**: Store link groups in `src/lib/footer.ts` per the copy-in-lib pattern (one config per section). Use typed structures (see `src/lib/types.ts`) to enforce arrays of groups with `title` and `links` containing `label`, `href`, and optional `ariaLabel`.
- **Link targets**:
  - Press & News: `mailto:press@pyresauna.com?subject=Press%20Inquiry%20-%20Pyre%20Sauna`
  - Contact Us: `/contact` (placeholder route)
  - Our Mission: `/mission` (placeholder route)
  - FAQs: `/faqs` (placeholder route)
  - Health & Safety: `/health-and-safety` (placeholder route)
  - Privacy Policy: `/privacy-policy` (placeholder route)
  - Cookie Policy: `/cookie-policy` (placeholder route)
  - Terms of Service: `/terms-of-service` (placeholder route)
- **Presentation**: Footer component reads from `src/lib/footer.ts`. Use Tailwind for layout/spacing, match existing footer styles, and maintain WCAG AA contrast.
- **Navigation behavior**: Use semantic `<footer>` landmark; ensure keyboard navigation order is logical by grouping sections in DOM order.

