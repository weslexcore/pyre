### 0019 — README Update (Technical Plan)

**Brief summary (verbatim intent):** Update the repository `README.md` to clearly state the site’s purpose and current sections, list the concrete tech stack actually used in this repo (Astro, Tailwind v4 via Vite plugin, optional React, Yarn 4, Prettier, image optimization, TypeScript), point contributors to the commands under `docs/commands/`, feature plans under `docs/features/`, and briefs under `docs/briefs/`, mention that copy is centralized under `src/lib` and styling in `src/styles/global.css`, note the signup API route at `src/pages/api/subscribe.ts`, and the GitHub Pages-friendly base/site configuration.

### Context
- The repo is an Astro-based marketing site with the following sections: `Navbar`, `Hero`, `ExperiencesSection`, `StorySection`, `BreakSection`, `SignupForm`, `Footer`.
- Package/tooling based on repo state:
  - Astro `^5` (see `astro.config.mjs`)
  - Tailwind CSS `^4` via `@tailwindcss/vite`
  - Optional React via `@astrojs/react`
  - TypeScript enabled via `src/env.d.ts`
  - Package manager: Yarn 4 (Corepack) as defined in `package.json#packageManager`
  - Prettier with Astro and Tailwind plugins
  - Image optimization via Sharp service configured in `astro.config.mjs`
  - Assets: webfonts in `public/fonts`, images in `public/images`, logos in `public/logos`
- GitHub Pages-friendly config is present: `astro.config.mjs` uses `process.env.ASTRO_SITE` and `process.env.ASTRO_BASE` (defaults `base` to `"/pyre"`).

### Files to change
- Edit: `README.md`

### Planned README structure and concrete edits
1) Project overview / description
   - Purpose: Public marketing/landing site for Pyre. Communicates brand, story, and offerings with fast performance and simple content structure.
   - List current sections exactly: `Navbar`, `Hero`, `ExperiencesSection`, `StorySection`, `BreakSection`, `SignupForm`, `Footer`.

2) Tech stack / architecture actually used
   - Framework: Astro `^5`.
   - Styling: Tailwind CSS `^4` via `@tailwindcss/vite` (explicitly call out no DaisyUI; reference guard script `yarn run check:no-daisyui`).
   - UI: Astro components with optional React islands via `@astrojs/react`.
   - Languages/Types: TypeScript (see `src/env.d.ts`).
   - Package manager: Yarn 4 (Corepack-ready) pinned in `package.json#packageManager`.
   - Tooling: Prettier with `prettier-plugin-astro` and `prettier-plugin-tailwindcss`.
   - Images: Sharp image service configured via `astro.config.mjs`.
   - Pages/Layout: `src/pages/index.astro` and `src/layouts/main.astro`.

3) Content configuration and styling location
   - Copy/config centralized in `src/lib/*.ts` per internal rule "012-copy-configs".
   - Styling lives in `src/styles/global.css`; Tailwind-first approach.

4) Commands and documentation pointers
   - Link to authoring workflow commands under `docs/commands/`:
     - `docs/commands/create_brief.md`
     - `docs/commands/plan_feature.md`
     - `docs/commands/create_bugfix_brief.md`
     - `docs/commands/plan_bugfix.md`
     - `docs/commands/code_review.md`
     - `docs/commands/bugfix_review.md`
   - Feature plans and reviews: `docs/features/` (e.g., `0001_PLAN.md`, `0004_REVIEW.md`, ...)
   - Briefs archive: `docs/briefs/`
   - Internal rules to reference by name (summarize): `012-copy-configs`, `tailwind_first`, `design_system`, `component_usage`, `nvm-node-setup`, `package_manager`.

5) Development and scripts
   - Node setup: recommend Node 22 LTS with `nvm` and Corepack (aligns with internal `nvm-node-setup` rule).
   - Yarn: `yarn install --immutable`
   - Scripts: `yarn dev`, `yarn build` (runs `prebuild` guard for DaisyUI), `yarn preview`, `yarn format`.

6) API and deployment notes
   - Signup API route: `src/pages/api/subscribe.ts` (stubbed; replace with provider integration later).
   - GitHub Pages-friendly config: mention `astro.config.mjs` uses `ASTRO_SITE` and `ASTRO_BASE` (default `base: "/pyre"`); link to the auto-deploy plan `docs/features/0018_GITHUB_PAGES_AUTO_DEPLOY_PLAN.md` if desired.

### Step-by-step edit algorithm
1. Open `README.md` and replace the current template content with the structured sections listed above.
2. Use exact section/component names and file paths from this plan (verbatim strings) to avoid drift.
3. Under Tech stack, enumerate the tools using the actual packages present in `package.json` and configuration in `astro.config.mjs`.
4. Add relative links to all referenced docs under `docs/commands/`, `docs/features/`, and `docs/briefs/`.
5. Add a short "Content & Styling" section that explicitly calls out `src/lib` and `src/styles/global.css`.
6. Add a short "API & Deploy" section that names `src/pages/api/subscribe.ts` and the GH Pages-friendly `site`/`base` config.
7. Add a "Getting started" snippet with Node/Yarn/Corepack and the `yarn` scripts.
8. Save the file and run `yarn format` to ensure Prettier formatting.

### Acceptance checklist (map to brief)
- README states the site’s purpose and lists current sections.
- README lists the concrete tech stack actually used: Astro, Tailwind v4 via Vite plugin, optional React, Yarn 4, Prettier, image optimization (Sharp), TypeScript.
- README links to `docs/commands/*`, `docs/features/`, and `docs/briefs/`.
- README mentions content configuration location (`src/lib`) and styling approach (`src/styles/global.css`).
- README notes the signup API route (`src/pages/api/subscribe.ts`).
- README mentions GH Pages-friendly configuration in `astro.config.mjs`.


