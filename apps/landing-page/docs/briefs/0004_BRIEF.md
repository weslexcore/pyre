# TailwindCSS Migration & Enforcement

## 1. Project overview / description
Convert all existing CSS class usage in templates and components to TailwindCSS utility classes declared directly on the element. Minimize reliance on custom CSS by migrating component and page styles to Tailwind utilities. Establish an explicit Cursor rule to enforce Tailwind-first styling going forward.

## 2. Target audience
- Engineering team maintaining `src/pages`, `src/components`, and `src/layouts`
- Reviewers enforcing styling conventions
- Designers who benefit from consistent, token-driven implementation

## 3. Primary benefits / features
- Maintainability: Eliminate ad‑hoc class naming and reduce CSS drift.
- Consistency: Single source of truth for spacing, colors, typography via Tailwind.
- Velocity: Faster iteration with utility-first styling; fewer context switches.
- Bundle health: Tree-shaken utilities reduce unused CSS.
- Enforcement: Cursor rule plus formatting/linting guardrails to prefer Tailwind utilities over custom classes.

Scope includes:
- Migrate styling in `src/pages`, `src/components`, `src/layouts` to Tailwind utility classes inline.
- Keep `src/styles/global.css` only for global resets, fonts, and rare cross-app primitives that cannot be expressed as utilities.
- Add guardrails: Prettier Tailwind plugin for class sorting, optional `eslint-plugin-tailwindcss`, and a Cursor rule that flags non-Tailwind class usage and discourages new global/component CSS.

## 4. High-level tech/architecture used
- TailwindCSS configured for Astro, with JIT and content paths covering `src/**/*.astro`, `src/**/*.ts(x)`.
- Prettier plugin `prettier-plugin-tailwindcss` to auto-sort utility classes.
- Optional `eslint-plugin-tailwindcss` to validate class names and configuration.
- Cursor rule: “Always use TailwindCSS utility classes on elements. Avoid new custom classes and `@apply` unless a utility cannot express the requirement. Global CSS limited to resets, fonts, and rare, shared primitives.”
- Design tokens mapped to Tailwind theme (colors, spacing, typography) to align with the design system.

Non-goals / out of scope:
- Large-scale design changes; this is a like-for-like migration of styling expression.
- Replacing global fonts or assets.
# Mailing List Sign-up + Hero Refactor

## 1) Project overview / description
Add an email sign-up flow to the landing page and refactor the hero for maintainability.
- Place a newsletter sign-up section directly below the hero. It collects an email address and includes supporting copy: “Sign up for our newsletter and stay updated on opening and introductory offers.” Plus a privacy reassurance: “We will only send essential info and tangible offers.”
- Add a “Join the mailing list” button to the top-right of the hero.
- Create a reusable `Button` component for visual consistency across CTAs.
- Extract the hero into its own `Hero` component.

## 2) Target audience
- Prospective members and wellness enthusiasts in/near Richmond, VA
- Early adopters interested in opening updates, promotions, and offers

## 3) Primary benefits / features
- Newsletter block immediately below hero with clear headline, short copy, and single email input field
- Accessible form with proper label, inline validation messaging, and keyboard/focus support
- Submits to existing API endpoint (`/api/subscribe`) using standard form POST (progressive enhancement) and optional JSON fetch
- Top-right hero CTA “Join the mailing list” using the shared `Button` component; anchors/scrolls to the sign-up block
- Consistent styles via reusable `Button` and Tailwind utilities (avoid new global CSS selectors)
- Mobile-first, responsive layout; legible type and adequate spacing

## 4) High-level tech/architecture used
- Astro components: `Hero.astro`, `Button.astro`, `SignupForm.astro`
- Styling with Tailwind utilities per workspace guidelines; keep `global.css` for tokens/resets only
- Form posts to `src/pages/api/subscribe.ts` (already implemented) with server-side email validation and graceful fallback redirect to `/?subscribed=1`
- Optional client-side enhancement (smooth scroll from hero CTA to sign-up, inline validation)
- No third-party email provider integration in this scope; existing API remains stubbed for future provider wiring


