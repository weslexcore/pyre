Project overview / description

When serving the site via GitHub Pages or `astro preview`, assets in `public/` (images, fonts) fail to load because the Astro `base` setting is not consistently applied to asset URLs. This work introduces a single source of truth for the asset base path that propagates to all asset references (images, fonts, and any static imports), ensuring correct URLs across environments and deploy targets.

Target audience

- Developers maintaining the site build/deploy pipeline
- Content/design contributors who reference images and fonts

Primary benefits / features

- Consistent asset paths across local dev, `astro preview`, and GitHub Pages
- Environment-configurable base path (e.g., `/repo-name/` for GitHub Pages)
- Centralized configuration to avoid hard-coded or duplicated paths
- Reduced 404s for images and fonts; improved reliability of static assets

High-level tech/architecture used

- Use Astro `base` in `astro.config.mjs` as the canonical base path
- Expose the base path via a small configuration module (importable variable) for use in components, styles, and utilities
- Ensure all asset references (e.g., `<img src>`, CSS `url()`, font-face src, and any dynamic asset helpers) build URLs from the shared base variable
- Validate behavior in both `astro preview` and GitHub Pages environments

