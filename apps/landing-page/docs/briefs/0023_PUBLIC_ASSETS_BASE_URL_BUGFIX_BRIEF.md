### 1) Project overview / description
Public images and symbols fail to load when the site is deployed under a non-root base (e.g., `/pyre`). Console errors indicate that request URLs for `public/` assets must include the configured base, but components currently reference absolute paths like `/images/...` and `/symbols/...`. We need a consistent strategy so all public asset URLs automatically respect the configured base in both dev and build.

### 2) Target audience
- Site visitors when the site is hosted under a subpath (GitHub Pages, subfolder hosting)
- Developers maintaining components and styles that reference public assets

### 3) Primary benefits / features
- All public assets (images, symbols, logos, fonts, background images) resolve correctly when `base` is not `/`
- Centralized helper for generating public asset URLs that prepend the configured base
- Components and layouts updated to use the helper (or module imports for assets) instead of hardcoded `/...` paths
- Coverage across `Hero`, `ExperiencesSection`, `StorySection`, `BreakSection`, `Footer`, `Navbar`, `SignupForm`, `layouts/main.astro`, and any CSS using background images
- Verification in dev and production builds; brief guidance added to `README`

### 4) High-level tech / architecture used
- Use `import.meta.env.BASE_URL` to derive the deploy base at runtime/build
- Provide a small utility (e.g., `src/lib/paths.ts`) exposing `publicPath(path: string)` that safely joins `BASE_URL` with public asset paths
- Prefer imported/bundled assets from `src` (e.g., `import img from '../assets/foo.png'`) so the bundler handles base automatically; otherwise use the `publicPath(...)` helper in `.astro` components
- Audit and replace hardcoded absolute paths in `.astro` components and any inline styles; handle CSS backgrounds via in-component styles or CSS variables that incorporate the base
