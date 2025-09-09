0031_FOOTER_NAV_EXPANSION_PLAN

Description
- Expand the site footer to include grouped navigation links for Press, Support, Company, and Legal. Add a mailto action for press inquiries and placeholder routes for internal pages. Follow the copy-in-lib pattern by centralizing content in `src/lib/footer.ts` with strict typing in `src/lib/types.ts`. The `Footer.astro` component will render from config.

Scope of Changes
- `src/lib/types.ts`: Extend `FooterContent` to support grouped links.
- `src/lib/footer.ts`: Add new grouped link content and press mailto.
- `src/components/Footer.astro`: Render grouped links with responsive layout and a11y.
- `src/pages/*`: Create placeholder pages for internal links: `/contact`, `/mission`, `/faqs`, `/health-and-safety`, `/privacy-policy`, `/cookie-policy`, `/terms-of-service` (minimal stubs; content to be implemented separately).

Data Model and Types
- Add a typed structure for footer nav groups to `src/lib/types.ts`:
  - `FooterNavGroup`: `{ title: string; links: Array<LinkRef> }` where `LinkRef` is the existing `{ label: string; href: string; ariaLabel?: string }`.
  - Extend `FooterContent` with optional `groups?: Array<FooterNavGroup>` while preserving existing `images`, `elements`, and `actions`.
- Rationale: Enforces the "copy configs in lib" pattern and enables predictable rendering. This aligns with the rule: store marketing copy/config in `src/lib` and import in components.

Footer Config Updates (`src/lib/footer.ts`)
- Add `groups` containing the following (verbatim from brief where applicable):
  - Press
    - "Press & News" → `mailto:press@pyresauna.com?subject=Press%20Inquiry%20-%20Pyre%20Sauna`
  - Support
    - "Contact Us" → `/contact`
    - "FAQs" → `/faqs`
    - "Health & Safety" → `/health-and-safety`
  - Company
    - "Our Mission" → `/mission`
  - Legal
    - "Privacy Policy" → `/privacy-policy`
    - "Cookie Policy" → `/cookie-policy`
    - "Terms of Service" → `/terms-of-service`
- Keep existing brand mark, hours, location, contact, and Instagram intact.
- Ensure `ariaLabel` fields are set where helpful (e.g., clarify purpose of links for screen readers). Example: `ariaLabel: "Email press@pyresauna.com for press inquiries"` for mailto.

Rendering Behavior (`src/components/Footer.astro`)
- Read `groups` from `footerConfig` and render each group with:
  - Group title as a heading element styled consistently with existing headings.
  - A list of links (`<ul><li><a/></li></ul>`) to ensure good semantics and keyboard navigation.
- Link behavior rules (deterministic algorithm):
  1) If `href` starts with `http://` or `https://`: render with `target="_blank"` and `rel="noopener noreferrer"` (external links open in a new tab).
  2) Else if `href` starts with `mailto:`: render as-is (no `target`), ensure a descriptive `aria-label` if not present.
  3) Else if `href` starts with `/`: treat as internal; pass through `withBase(href)` and open in same tab.
- Maintain existing Instagram external link behavior and contact email display.

Responsive Layout and Styles
- Mobile (default): stack sections; groups show in a vertical flow under brand/contact sections.
- Tablet/Desktop: present groups in multiple columns aligned with existing grid system. Use the same Tailwind token variables and typography classes already present in the footer.
- Ensure visible focus states on all anchors using the existing underline/hover/focus pattern.

Accessibility
- Use semantic `<footer>` (already present) and group headings for navigational regions. Optionally wrap each group in a `<nav aria-label="Footer - {Group Title}">` if desired, or provide a single `<nav aria-label="Footer">` containing all groups.
- Provide `ariaLabel` strings where link text may be ambiguous (e.g., mailto).
- Ensure logical DOM order: Brand → Contact/Social → Hours → Location → Groups.

Placeholder Routes (`src/pages/...`)
- Add Astro pages with minimal content (title and "Coming Soon"): `/contact`, `/mission`, `/faqs`, `/health-and-safety`, `/privacy-policy`, `/cookie-policy`, `/terms-of-service`.
- Each page should use the default `main.astro` layout and render a simple accessible heading for now.

Non-Functional Considerations
- Respect `import.meta.env.BASE_URL` by using `withBase` for internal links.
- Keep contrast WCAG AA; match existing text and background colors.
- Tailwind-first styling; no custom CSS unless necessary.

QA Checklist
- Footer renders all four groups with correct labels and destinations.
- Mailto opens default email app with subject "Press Inquiry - Pyre Sauna".
- Internal links navigate in same tab and work under a non-root `BASE_URL`.
- External links (Instagram) open in new tab with `rel` set.
- Mobile: groups stack; Desktop: groups appear in multi-column layout aligned to grid.
- Keyboard navigation traverses links logically with visible focus.

