0016 – Copy consolidation into src/lib (Technical Plan)

Brief context

Consolidate all site copy and text into the `src/lib` folder using one small configuration file per site section (Hero, Navbar, Story, Experiences, Break Section, Signup Form, Footer). Mirror the general approach used for the footer so content changes can be made by editing config files rather than component code. Enforce a consistent shape across all section configs using TypeScript types, ensuring clarity, safety, and easy maintenance.

Relevant files to change or create

- Create content config files in `src/lib/`
  - `src/lib/hero.ts`
  - `src/lib/navbar.ts`
  - `src/lib/story.ts`
  - `src/lib/experiences.ts`
  - `src/lib/breakSection.ts`
  - `src/lib/signupForm.ts`
  - Update/extend existing: `src/lib/footer.ts` (broaden to include all footer copy, not just contact/instagram)

- Define content types in `src/lib/types.ts`
  - Add section-specific interfaces and any shared base types for images/elements/actions/metadata (details below)

- Update components to import config from `src/lib/` and remove hardcoded copy
  - `src/components/Hero.astro`
  - `src/components/Navbar.astro`
  - `src/components/StorySection.astro`
  - `src/components/ExperiencesSection.astro`
  - `src/components/BreakSection.astro`
  - `src/components/SignupForm.astro`
  - `src/components/Footer.astro`

- Add a Cursor rule to enforce the new copy pattern
  - Create: `.cursor/rules/012-copy-configs.mdc`
  - Format and location per workspace rules (see rule details at end)

Type system (no code, shapes only)

All section configs share a consistent, predictable structure centered around `images`, `elements`, and optional `actions` and `metadata`. Use lowerCamelCase keys. Text values are plain strings; arrays are used for ordered lists.

- Shared primitives
  - `ImageRef`: `{ src: string; alt?: string; ariaLabel?: string }`
  - `LinkRef`: `{ label: string; href: string; ariaLabel?: string }`
  - `ActionRef`: `{ label: string; href: string; ariaLabel?: string }`

- Hero (`HeroContent`)
  - `images`: `{ centerLogo: ImageRef; background: ImageRef }`
  - `elements`: `{ heroText: string; subText: string; bottomLine: string; leftWord: string; rightWord: string }`
  - `actions?`: `{ primary?: ActionRef }`

- Navbar (`NavbarContent`)
  - `images`: `{ brandMark: ImageRef }`
  - `elements`: `{ ariaLabel: string; links?: Array<LinkRef> }`
  - `actions?`: `{ primary?: ActionRef }` (e.g., “Join the mailing list”)

- Story Section (`StoryContent`)
  - `images`: `{ background: ImageRef; symbol?: ImageRef }`
  - `elements`: `{ title: string; body: string[]; emphasisList?: string[] }`
  - `actions?`: `{ primary?: ActionRef }` (e.g., “Join the Waitlist” -> `#signup`)

- Experiences Section (`ExperiencesContent`)
  - `elements`: `{ title: string; items: Array<{ icon?: ImageRef; title: string; description: string; bullets?: string[]; link?: LinkRef; linkText?: string }> }`

- Break Section (`BreakSectionContent`)
  - `images`: `{ background?: ImageRef }`
  - `elements`: `{ headingTop: string; words: string[]; buttonLabel: string; intervalMs?: number }`
  - `actions?`: `{ primary?: ActionRef }` (button target)

- Signup Form (`SignupFormContent`)
  - `images`: `{ background: ImageRef; panel: ImageRef; symbol?: ImageRef }`
  - `elements`: `{ title: string; subtitle: string; emailLabel: string; submitLabel: string; successMessage: string; errorMessage: string }`
  - `metadata?`: `{ subscribedParam?: string }` (e.g., `"subscribed"` query key)

- Footer (`FooterContent`)
  - `images`: `{ brandMark?: ImageRef }`
  - `elements`: `{ hoursHeading: string; hoursText: string; locationHeading: string; locationText: string; contactHeading: string }`
  - `actions?`: `{ contactEmail?: string; instagram?: LinkRef }`

Implementation steps

1) Define content types in `src/lib/types.ts`
   - Add the interfaces listed above. Keep names and property spellings exact to enforce consistency.
   - Export types for use by config files and components.

2) Create one config file per section under `src/lib/`
   - Populate each with the current literals extracted from components as initial values (no logic).
   - Example mappings (values come directly from current code):
     - Hero.astro → `heroText` ("A BATHHOUSE, REIMAGINED"), `leftWord` ("Self-care."), `rightWord` ("Together."), `bottomLine` ("RICHMOND, VA + SPRING 2026"), images `centerLogo` (`/logos/creme/logo.png`, alt "Pyre Sauna logo"), `background` (`/images/hero.png`).
     - Navbar.astro → image `brandMark` (`/logos/creme/logo_with_text.png`, alt "Pyre Sauna + Cold Plunge"), action primary (label "Join the mailing list", href `#signup`, ariaLabel "Join the mailing list").
     - StorySection.astro → `title` ("RITUALS FOR MODERN LIFE"), `body` (paragraphs), `emphasisList` (["Yourself", "Your Community", "The Present Moment"]), symbol image `/symbols/sauna-symbol.png` with alt, background `/images/sauna_ladle_multiexposure.jpeg`.
     - ExperiencesSection.astro → `title` ("EXPERIENCES"), `items` (array of current card data: titles, icons, desc, bullets, link+linkText).
     - BreakSection.astro → `headingTop` ("PYRE IS A SPACE TO"), `words` (current defaults: RECONNECT, DISCONNECT, MAKE A FRIEND, BREATHE, HEAL), `buttonLabel` ("SPEND TIME WITH US"), `intervalMs` (2000), `actions.primary.href` (default `#signup`). Optionally `images.background` (`/images/giant_clouds.jpeg`).
     - SignupForm.astro → `title` ("SIGN UP"), `subtitle` ("Join our mailing list…"), `emailLabel` ("Email address"), `submitLabel` ("Join the mailing list"), `successMessage` ("Thanks for subscribing!"), `errorMessage` ("Please enter a valid email."), images: background `/images/orbs.jpeg`, panel `/images/heads_with_flowers.jpeg` (alt currently says "A hand holding red flowers"), symbol `/symbols/connection-symbol.png` (alt "Connection symbol").
     - Footer.astro + `src/lib/footer.ts` → move all copy into config: `hoursHeading` ("Hours"), `hoursText` ("Coming Soon"), `locationHeading` ("Location"), `locationText` ("Coming Soon"), `contactHeading` ("Contact"), `actions.contactEmail` (exists), `actions.instagram` (exists). Include optional `images.brandMark` and its alt (component currently uses `/logos/creme/logo.png` with alt "Pyre Sauna + Cold Plunge logo").

3) Update components to read from config
   - Import section config at top of each component from `../lib/<section>`.
   - Replace hardcoded strings/paths with references from the imported config.
   - Maintain existing layout, classes, and behavior; do not change structure or styles.
   - Ensure `alt` and `aria-label` values are sourced from config where applicable.
   - BreakSection: keep current props (`words`, `intervalMs`, `ctaHref`) but default to values from config when props are not provided. Preserve the current fade logic and reduced motion handling.

4) Keep copy-only changes confined to config files
   - After this change, any future updates to textual content or labels should happen exclusively in the relevant `src/lib/*.ts` file.
   - Components should only read from config; no literals except strictly presentational, non-copy tokens (e.g., visually hidden labels unique to layout only if truly fixed).

5) Accessibility and naming
   - Ensure all images in configs include `alt` where meaningful; allow empty alt for decorative images and set `aria-hidden` in components as already done.
   - Provide `ariaLabel` on actions/links where screen reader context benefits (e.g., Navbar CTA and Footer Instagram).

6) Non-functional verification
   - Build and run the site to verify no visual or behavioral regressions.
   - Manually test the CTA focus logic in Story and the centering/focus in Signup with the new labels.

Notes on algorithms/transformations

- The transformation is a direct key-value mapping exercise:
  1. For each component, list all user-visible strings, link targets, and image refs.
  2. Create a corresponding key in the section config as specified above.
  3. Replace the literal in the component with `config.<section>.<path>` import usage.
  4. For arrays (e.g., `experiences.items`, `story.body`, `story.emphasisList`), keep the ordering identical to current presentation.
  5. Preserve all existing event listeners and client scripts; only the string sources change.

Cursor rule to add

- File: `.cursor/rules/012-copy-configs.mdc` (must live under `.cursor/rules/` per repo rules)
- Frontmatter (shape only):
  - `description`: "Copy configs: Enforce storing all marketing site copy in `src/lib` section config files; components import from there."
  - `globs`: `src/components/**/*.astro, src/lib/**/*.ts`
  - `alwaysApply`: false
- Content guidance:
  - When adding or editing copy for sections (Hero, Navbar, Story, Experiences, Break Section, Signup Form, Footer), write text and labels into the corresponding `src/lib/<section>.ts` file. Avoid hardcoding copy in components.
  - Maintain the consistent types in `src/lib/types.ts` (images, elements, optional actions/metadata).
  - Include `alt`/`ariaLabel` in configs where applicable.
  - For new sections, create a new `src/lib/<section>.ts` and define a `<Section>Content` interface.

Out-of-scope

- No runtime fetching or CMS integration; configs are static imports.
- No design/layout changes beyond switching value sources to config.
- No i18n or localization in this change (future-ready only).


