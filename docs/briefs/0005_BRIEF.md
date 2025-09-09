
### Project overview / description

Remove `daisyUI` as a dependency across the codebase and tooling. Replace any `daisyUI` usage with Tailwind CSS core utilities and custom components aligned to the Pyre Design System. Update documentation and rules so `daisyUI` is not reintroduced by accident.

### Target audience

- **Site visitors**: Benefit from smaller payloads and consistent styling.
- **Developers/maintainers**: Simpler dependency graph and a Tailwind-first workflow.
- **DevOps/CI**: Fewer transitive dependencies and advisories.

### Primary benefits / features

- **Reduced bundle size and faster builds**: Remove plugin code, CSS, and transitive deps.
- **Design system alignment**: Enforce Tailwind-first patterns per Pyre Design System; avoid plugin-specific styles.
- **Lower maintenance and risk**: Fewer updates, fewer security advisories.
- **Consistency**: Custom primitives/components with predictable tokens instead of plugin abstractions.
- **Guardrails to prevent reintroduction**:
  - Remove from `package.json` dependencies and lockfile.
  - Remove from Tailwind config `plugins` and any theme extensions tied to `daisyUI`.
  - Replace all component/class usage originating from `daisyUI` with Tailwind utilities or project components.
  - Update docs, rules, and commands to state Tailwind-only usage.
  - Add a lightweight CI check to fail on `daisyui` occurrence in lockfile/configs.

### High-level tech/architecture used

- **Astro** for site generation.
- **Tailwind CSS (core only)** for styling; no UI plugin.
- **Node + Yarn** for dependency management.
- **Pyre Design System** tokens and Tailwind utilities for components.
