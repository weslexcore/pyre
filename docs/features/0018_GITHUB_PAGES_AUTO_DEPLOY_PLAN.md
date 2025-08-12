### 0018 — GitHub Pages Auto-Deploy (Technical Plan)

**Brief summary (verbatim intent):** Enable continuous deployment to GitHub Pages so that every push to the default branch automatically builds the site and publishes the latest version. Primary benefits include: automatic deploys on push, fast/repeatable builds with caching, optional PR previews, rollback confidence via deployment history, and a single source of truth with fully scripted deployments.

### Context
- Framework: Astro (build outputs to `dist/`).
- Package manager: `yarn` (Yarn 4; `packageManager` set in `package.json`).
- Node: Use Node 22 LTS in CI.
- Default branch: current repo default appears to be `master`.
- Repo already has `yarn build` with a `prebuild` script guard; CI must run `yarn build` (which will run `prebuild`).

### Files to add/change
- Add: `.github/workflows/pages.yml` — GitHub Actions workflow to build and deploy to GitHub Pages.
- Optional add: `.nvmrc` with `22` to pin Node locally/CI consistently (aligns with nvm/corepack workflow).
- Optional edit (only if deploying to a project site, not `username.github.io`): `astro.config.mjs`
  - Set `site` to the public site URL.
  - Set `base` to `/<repo>` for project pages (e.g., `"/pyre"`).

### Workflow design (algorithm)
1. Trigger conditions
   - `on: push` to the default branch (`master` for this repo).
   - Optional: `on: pull_request` for ephemeral preview deployments.

2. Required permissions and environment
   - `permissions`: `contents: read`, `pages: write`, `id-token: write`.
   - `environment`: `github-pages` with URL from `steps.deployment.outputs.page_url`.
   - Concurrency: cancel in-progress runs for the same ref (single deploy at a time).

3. Build job steps (Ubuntu runner)
   - Checkout: `actions/checkout@v4` with a shallow fetch.
   - Setup Node: `actions/setup-node@v4` with Node `22` and enable Corepack (so Yarn 4 is respected from `package.json#packageManager`).
   - Cache Yarn Berry artifacts: `actions/cache@v4`
     - `path`: `.yarn/cache`
     - `key`: `${{ runner.os }}-yarn-${{ hashFiles('**/yarn.lock') }}`
     - `restore-keys`: `${{ runner.os }}-yarn-`
   - Install deps: `yarn install --immutable`.
   - Build site: `yarn build` (outputs to `dist/`).
   - Configure Pages: `actions/configure-pages@v5`.
   - Upload artifact: `actions/upload-pages-artifact@v3` with `path: ./dist`.
   - Deploy: `actions/deploy-pages@v4` (id: `deployment`).

4. Optional PR preview flow
   - Also trigger on `pull_request` (non-blocking).
   - Reuse the same build steps; deploy via `actions/deploy-pages@v4` on PR events to create an ephemeral preview.
   - Gate preview deploys with `if: github.event_name == 'pull_request'` to avoid conflicts.

### Repo settings (one-time)
- In GitHub repo → Settings → Pages:
  - Set Source to "GitHub Actions".
  - (Optional) Configure custom domain; ensure `astro.config.mjs#site` matches the canonical URL.

### Notes specific to this repo
- Yarn 4 is already configured via `package.json#packageManager`. CI should run `corepack enable` (or rely on `actions/setup-node` + Corepack) so the correct Yarn version is used.
- The Astro config uses the Sharp image service; `ubuntu-latest` runners have necessary dependencies by default.
- If deploying to a project site (not root user/org site), set `base` in `astro.config.mjs` to match the repository path to ensure assets resolve correctly.

### Acceptance checklist
- Pushing to `master` runs CI, builds with Node 22 and Yarn 4, and publishes `dist/` to GitHub Pages.
- Public URL is exposed in the deployment summary, and the `github-pages` environment tracks history for rollback.
- Yarn cache is used between runs to speed up installs.
- (If enabled) Pull requests get ephemeral preview URLs without impacting the main site.

### Future enhancements (non-blocking)
- Add automated link checking and `astro check` in CI before deploy.
- Add a workflow badge to `README.md`.
- Add status checks to require a successful build before merging to the default branch.