## Pyre Marketing Site (Astro + Tailwind v4)

Public marketing/landing site for Pyre. Communicates brand, story, and offerings with fast performance and simple content structure.

### Tech stack / architecture actually used

- **Framework**: Astro `^5`.
- **Styling**: Tailwind CSS `^4` via `@tailwindcss/vite` (no DaisyUI). A guard runs during build: `yarn run check:no-daisyui`.
- **UI**: Astro components with optional React islands via `@astrojs/react`.
- **Languages/Types**: TypeScript (see `src/env.d.ts`).
- **Package manager**: Yarn 4 (Corepack), pinned in `package.json#packageManager`.
- **Tooling**: Prettier with `prettier-plugin-astro` and `prettier-plugin-tailwindcss`.
- **Images**: Sharp image service configured in `astro.config.mjs`.
- **Pages/Layout**: `src/pages/index.astro` and `src/layouts/main.astro`.
- **Assets**: webfonts in `public/fonts`, images in `public/images`, logos in `public/logos`.

### Content configuration and styling location

- **Copy/config** is centralized in `src/lib/*.ts` per internal rule "012-copy-configs".
- **Styling** lives in `src/styles/global.css` with a Tailwind-first approach.

### Commands and documentation pointers

- **Authoring workflow commands** (`docs/commands/`):
  - [`docs/commands/create_brief.md`](docs/commands/create_brief.md)
  - [`docs/commands/plan_feature.md`](docs/commands/plan_feature.md)
  - [`docs/commands/create_bugfix_brief.md`](docs/commands/create_bugfix_brief.md)
  - [`docs/commands/plan_bugfix.md`](docs/commands/plan_bugfix.md)
  - [`docs/commands/code_review.md`](docs/commands/code_review.md)
  - [`docs/commands/bugfix_review.md`](docs/commands/bugfix_review.md)
- **Feature plans and reviews**: [`docs/features/`](docs/features/) (e.g., `0001_PLAN.md`, `0004_REVIEW.md`, ...)
- **Briefs archive**: [`docs/briefs/`](docs/briefs/)
- **Internal rules to reference**: `012-copy-configs`, `tailwind_first`, `design_system`, `component_usage`, `nvm-node-setup`, `package_manager`.

### Development and scripts

- **Node setup**: Use Node 22 LTS with `nvm`, and enable Corepack (aligns with internal `nvm-node-setup`).
- **Install**: `yarn install --immutable`
- **Scripts**:
  - `yarn dev` — start dev server
  - `yarn build` — production build (runs prebuild guard for DaisyUI)
  - `yarn preview` — preview production build
  - `yarn format` — run Prettier across the repo

### API and deployment notes

- **Signup API route**: `src/pages/api/subscribe.ts` (stubbed; replace with provider integration later).
- **GitHub Pages-friendly config**: `astro.config.mjs` uses environment variables `ASTRO_SITE` and `ASTRO_BASE` (defaults to `base: "/pyre"`). See also the auto-deploy plan: [`docs/features/0018_GITHUB_PAGES_AUTO_DEPLOY_PLAN.md`](docs/features/0018_GITHUB_PAGES_AUTO_DEPLOY_PLAN.md).

### Getting started

```bash
# 1) Ensure Node 22 LTS and enable Corepack
nvm install 22
nvm use 22
corepack enable

# 2) Install dependencies (Yarn 4)
yarn install --immutable

# 3) Develop, build, preview
yarn dev
yarn build
yarn preview

# 4) Format code
yarn format
```
