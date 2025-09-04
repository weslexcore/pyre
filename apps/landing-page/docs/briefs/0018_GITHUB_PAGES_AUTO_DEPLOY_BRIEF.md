### Project overview / description
Enable continuous deployment to GitHub Pages so that every push to the default branch automatically builds the site and publishes the latest version. This introduces a simple, reliable CI/CD pipeline using GitHub Actions that compiles the site (e.g., Astro static build) and ships the generated output to GitHub Pages without manual steps.

### Target audience
- **Developers/maintainers**: Want frictionless deploys on merge.
- **Content editors**: Need fast, predictable updates after pushing changes.
- **Stakeholders/QA**: Expect the live site to reflect the latest approved work.

### Primary benefits / features
- **Automatic deploys on push**: Changes to `main` (or the default branch) trigger a build and publish.
- **Fast, repeatable builds**: Dependency caching for Node modules to reduce build times.
- **Optional PR previews**: Ephemeral preview deployments for pull requests (non-blocking and configurable).
- **Rollback confidence**: Previous successful deployments remain accessible via GitHub deployments history.
- **Single source of truth**: No local/manual steps; deployments are fully scripted and auditable.

### High-level tech/architecture used
- **Platform**: GitHub Actions + GitHub Pages.
- **Workflow**: On `push` to default branch (and optionally `pull_request`).
- **Build**: Node 20 LTS, install dependencies (`npm`/`pnpm` per repo), run site build (e.g., `npm run build`).
- **Artifact → Pages**: Upload built `dist/` (or framework output dir) via `actions/upload-pages-artifact` and deploy with `actions/deploy-pages` (or publish to `gh-pages` branch if preferred).
- **Caching**: Actions cache for package manager lockfile to speed builds.
- **Secrets/permissions**: Use built-in `GITHUB_TOKEN` with `pages: write` and `id-token: write` permissions.


