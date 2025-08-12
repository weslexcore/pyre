# README Update Brief — Pyre Marketing Site

## 1) Project overview / description
- Purpose: Public marketing/landing site for Pyre. Communicates brand, story, and offerings with fast performance and simple content structure. Includes a basic signup form endpoint to collect interest.
- Site sections (current): `Navbar`, `Hero`, `ExperiencesSection`, `StorySection`, `BreakSection`, `SignupForm`, `Footer`.
- Copy is centralized in `src/lib/*.ts` config modules and imported by components.

## 2) Target audience
- Primary: Pyre team members and open-source contributors maintaining the marketing site (designers, content editors, and developers).
- Secondary: Prospective visitors evaluating Pyre (performance and accessibility goals).

## 3) Primary benefits / features
- Centralized copy/config in `src/lib` per 012-copy-configs rule for consistent content management.
- Modern, minimal stack with Astro for fast SSR/SSG and optional React for islands.
- Tailwind-first styling with a small, opinionated brand design system (custom fonts, colors, tokens) in `src/styles/global.css`.
- Image optimization configured via Astro Sharp service (`astro.config.mjs`).
- Simple email signup endpoint at `src/pages/api/subscribe.ts` (stubbed for provider integration).
- GitHub Pages-friendly base/site configuration via environment variables in `astro.config.mjs` (supports project subpath deploys).

## 4) High-level tech / architecture used
- Framework: Astro ^5 (see `astro.config.mjs`).
- Styling: Tailwind CSS ^4 via `@tailwindcss/vite`; no DaisyUI allowed (guarded by `yarn run check:no-daisyui`).
- UI: Astro components with optional React islands (`@astrojs/react`).
- Languages/Types: TypeScript enabled (see `src/env.d.ts`).
- Package manager: Yarn 4 (Corepack-ready) as set in `package.json`.
- Tooling: Prettier with Astro and Tailwind plugins.
- Assets: Local webfonts in `public/fonts`, images in `public/images`, logos in `public/logos`.
- Pages/Layout: `src/pages/index.astro` with `src/layouts/main.astro`.

## Docs to link in README (contributing + workflow)
- Commands (authoring workflow):
  - `docs/commands/create_brief.md`
  - `docs/commands/plan_feature.md`
  - `docs/commands/create_bugfix_brief.md`
  - `docs/commands/plan_bugfix.md`
  - `docs/commands/code_review.md`
  - `docs/commands/bugfix_review.md`
- Feature plans and reviews: `docs/features/` (e.g., `0001_PLAN.md`, `0004_REVIEW.md`, ...)
- Briefs archive: `docs/briefs/`
- Key internal rules to reference in development (summarize/link from README):
  - Copy configs rule: 012-copy-configs (copy in `src/lib`)
  - Tailwind-first styling: tailwind_first
  - Design system guidance: design_system
  - Component usage patterns: component_usage
  - Node/PM setup: nvm-node-setup, package_manager

## Acceptance criteria for README update
- Clearly states the site’s purpose and current sections.
- Lists the concrete tech stack actually used in this repo (Astro, Tailwind v4 via Vite plugin, optional React, Yarn 4, Prettier, image optimization, TypeScript).
- Points contributors to the commands under `docs/commands/`, feature plans under `docs/features/`, and briefs under `docs/briefs/`.
- Mentions content configuration location (`src/lib`) and styling approach (`src/styles/global.css`).
- Notes the signup API route and the GH Pages-friendly config.

