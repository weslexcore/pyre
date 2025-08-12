Project overview / description

Consolidate all site copy and text into the `src/lib` folder using one small configuration file per site section (e.g., Hero, Navbar, Story, Experiences, Break Section, Signup Form, Footer). Mirror the general approach used for the footer so content changes can be made by editing config files rather than component code. Enforce a consistent shape across all section configs using TypeScript types, ensuring clarity, safety, and easy maintenance.

Create a cursor rule that ensures all future copy is written into an easy to maintain copy file. 

Target audience

- Internal developers maintaining the marketing site
- Non-technical stakeholders who review content via PRs/version control

Primary benefits / features

- Single source of truth for all copy and text
- Minimal changes needed to update content (no component edits for content-only changes)
- Consistent, predictable schema across sections
- Type safety via shared TypeScript types
- Small, focused files that are easy to scan and review
- Clear separation of concerns between presentation (components) and content (configs)
- Future-ready for localization and potential CMS integration

High-level tech / architecture used

- Location: store one config per section in `src/lib` (e.g., `hero.ts`, `navbar.ts`, `story.ts`, `experiences.ts`, `breakSection.ts`, `signupForm.ts`, `footer.ts`).
- Types: define shared and per-section TypeScript types in `src/lib/types.ts` to enforce a common shape: common groups like `section`, `images`, `elements`, and optional `actions`/`metadata` for accessibility.
- Access pattern: components import their section’s config directly from `src/lib`; no runtime fetching.
- Assets: image references stored as public paths or identifiers; include alt/aria labels where applicable.
- Naming conventions: lowerCamelCase keys; text values as plain strings; arrays for ordered lists (e.g., links, feature items).
- File hygiene: keep each config small and focused to simplify code review and updates.

Section shape guidance (no code)

- Hero
  - images: `centerLogo`, `background`
  - elements: `heroText`, `subText`, `ctaLabel`, `ctaHref`, `logoLeft`, `logoRight`

- Navbar
  - images: `brandMark`
  - elements: `links` (array of label + href), `ariaLabel`

- Story Section
  - images: `background`
  - elements: `title`, `body`

- Experiences Section
  - images: optional `icons`
  - elements: `title`, `items` (array of `icon`, `title`, `description`)

- Break Section
  - elements: `message`

- Signup Form
  - elements: `title`, `subtitle`, field labels, `submitLabel`, `successMessage`, `errorMessage`

- Footer (reference pattern)
  - elements: contact details, social links with `label` and `ariaLabel`

Notes

- Keep content-only changes confined to the relevant `src/lib` config file.
- Ensure accessibility fields (e.g., `alt`, `ariaLabel`) are present where needed.
- Favor consistency; add section-specific fields only when justified.

