### Feature: Implement Privacy Policy, Cookie Policy, and Terms of Service pages driven by config in `src/lib`

#### Brief description
Implement three legal policy pages (`/privacy-policy`, `/cookie-policy`, `/terms-of-service`) that render from centralized config in `src/lib`, making copy updates simple and consistent with the "Copy configs" convention. The supplied copy (from the user prompt) must be the source of truth in the config file(s) and rendered by the pages.

#### Files to create or modify
- `src/lib/types.ts`
  - Add typed interfaces for policy content to support structured sections, paragraphs, and lists.

- `src/lib/policies.ts` (new)
  - Export config objects for:
    - `privacyPolicy`
    - `cookiePolicy`
    - `termsOfService`
  - Each object contains:
    - `title` (string)
    - `effectiveDate` (ISO or display string)
    - `lastUpdated` (ISO or display string)
    - `intro` (optional string)
    - `sections` (array of structured sections; see Types below)

- `src/pages/privacy-policy.astro`
  - Replace placeholder content with rendering logic that consumes `privacyPolicy` from `src/lib/policies.ts`.
  - Pass page-specific `title` and `description` props into `Layout` for SEO.

- `src/pages/cookie-policy.astro`
  - Replace placeholder content with rendering logic that consumes `cookiePolicy` from `src/lib/policies.ts`.
  - Pass page-specific `title` and `description` props into `Layout` for SEO.

- `src/pages/terms-of-service.astro`
  - Replace placeholder content with rendering logic that consumes `termsOfService` from `src/lib/policies.ts`.
  - Pass page-specific `title` and `description` props into `Layout` for SEO.

- (Cleanup) `src/lib/privacyPolicy.ts` (untracked/partial)
  - Remove or migrate into `src/lib/policies.ts` to avoid duplication and follow the single-source config pattern.

#### Related files reviewed (no change unless noted)
- `src/components/Footer.astro` and `src/lib/footer.ts`
  - Footer already links to `/privacy-policy`, `/cookie-policy`, and `/terms-of-service`. No change required.
- `src/layouts/main.astro`
  - Supports per-page `title`/`description`. Pages will pass values derived from the policy config.

#### Types (data layer)
Add to `src/lib/types.ts`:
- `PolicyListItem`: `{ text: string }`
- `PolicyList`: `{ title?: string; items: Array<PolicyListItem> }`
- `PolicySection`: `{ heading: string; paragraphs?: Array<string>; lists?: Array<PolicyList> }`
- `PolicyDocument`: `{ title: string; effectiveDate?: string; lastUpdated?: string; intro?: string; sections: Array<PolicySection> }`

Notes:
- Lists allow optional `title` (e.g., "Third-Party Service Providers") and bullet items from the brief.
- Dates can be stored as display strings (e.g., `"08.15.2025"`) to match the provided copy, avoiding downstream formatting logic.

#### Rendering algorithm (per page)
1. Import the corresponding `PolicyDocument` object from `src/lib/policies.ts`.
2. Compute page `title` (e.g., `"Privacy Policy | Pyre Sauna"`) and a short `description` from the `intro` or first section paragraph.
3. Pass `title` and `description` to `Layout` via props.
4. Render:
   - `<h1>`: document `title`.
   - Meta line(s): `Effective Date` and `Last updated` if present.
   - Intro paragraph if provided.
   - For each `section`:
     - `<h2>` for `heading`.
     - Render each `paragraph` as `<p>` with existing typography classes.
     - For each `list` in `lists`:
       - If `title` present, render as `<h3>` or strong label above the list (choose consistent level across pages).
       - Render `<ul>` and `<li>` for each `items[].text`.
5. Ensure mobile-friendly spacing using the existing Tailwind classes used on other pages (mirror `max-w-screen-md`, `px-4`, `py-16`, `mt-*`).
6. Do not introduce MDX or markdown runtime; keep content structured in the config for simplicity and to comply with copy-in-`src/lib` convention.

#### Mapping the provided copy to the config
- Privacy Policy
  - `title`: "Privacy Policy"
  - `effectiveDate`: "08.15.2025"
  - `lastUpdated`: "08.15.2025"
  - `intro`: Combine the first two introductory paragraphs per the brief.
  - `sections`: Create a section per numbered heading (1–11), converting sub-points to paragraphs or lists as appropriate:
    - E.g., `2. Information We Collect` → two lists: "Information You Provide to Us" and "Information We Collect Automatically" with bullets provided.
    - Use a section for each of: Use of Information, Legal Basis (GDPR), Sharing & Disclosure, Data Security, Data Retention, Your Rights (with sub-list for CCPA), Children’s Privacy, Changes, Contact Us.

- Cookie Policy
  - `title`: "Cookie Policy"
  - `effectiveDate`: "08.15.2025"
  - `lastUpdated`: "08.15.2025"
  - `intro`: Brief definition of cookies from section 1, or keep as first section.
  - `sections`: Create sections matching headings 1–8 and represent cookies under Analytics as lists (include `_ga`, `_ga_*`, `_gid` descriptions). Include Opt-out links as text in paragraphs.

- Terms of Service
  - `title`: "Terms of Service"
  - `effectiveDate`: "08.15.2025"
  - `lastUpdated`: "08.15.2025"
  - `sections`: Map each numbered section 1–15 into a `PolicySection`, with bullets for sub-points (Accounts, Booking & Payment, Health & Safety, Prohibited Uses, IP, Disclaimers, Indemnification, Governing Law, Dispute Resolution, Severability, Changes, Contact).

#### SEO
- Each page passes a specific `title` and a concise `description` based on the intro, e.g.:
  - Privacy: description referencing the collection/use of personal data and rights.
  - Cookies: description referencing cookie purposes and management options.
  - Terms: description referencing booking, payment, and usage terms.
- No change to `src/lib/seo.ts` needed; per-page props are already supported by `src/layouts/main.astro`.

#### Accessibility and semantics
- Use semantic headings (`h1` > `h2` > `h3`) in order.
- Ensure link texts are descriptive (e.g., "Google Privacy Policy"). For external links, include `rel` attributes if needed (left to implementation standards already in the project).

#### Non-goals
- No CMS integration.
- No markdown/MDX parsing pipeline changes.
- No table-of-contents generation unless later requested.

#### Implementation notes
- Follow the "Copy configs" rule to consolidate all legal copy into `src/lib/policies.ts` and import into pages.
- Delete or replace `src/lib/privacyPolicy.ts` with the consolidated file to avoid duplicate sources.
- Match existing Tailwind typography classes used across pages for a consistent look.


