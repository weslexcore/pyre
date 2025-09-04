## 0005 Review — Remove DaisyUI, migrate to Tailwind core only, and add guardrails

### Overall
The DaisyUI removal has been implemented in code and styles, and guardrails have been added via a prebuild script. Components use Tailwind utilities and project tokens. A build could not be validated locally due to Node version mismatch (see Issues).

### Plan compliance
- Removal of DaisyUI from dependencies and styles: Met
  - `package.json` no longer lists DaisyUI and includes a guardrail script:
  
  ```6:13:package.json
  "build": "astro build",
  "prebuild": "yarn run check:no-daisyui",
  "check:no-daisyui": "sh -c 'if grep -R -n -E \"\\"daisyui\\"\\s*: \" package.json >/dev/null 2>&1; then echo \"Error: disallowed daisyui dependency in package.json\"; exit 1; fi; if grep -R -n -i daisyui yarn.lock >/dev/null 2>&1; then echo \"Error: disallowed daisyui in yarn.lock\"; exit 1; fi; if grep -R -n -E \"@plugin\\s+\\\"daisyui\\\";\" src/styles >/dev/null 2>&1; then echo \"Error: disallowed daisyui plugin usage in styles\"; exit 1; fi'"
  ```

  - `src/styles/global.css` no longer imports the DaisyUI plugin and explicitly notes its removal:

  ```4:8:src/styles/global.css
  @custom-variant dark (&:is(.dark *));
  
  /* Removed DaisyUI plugin and theme variables */
  ```

- Component audit and replacements: Met (no DaisyUI classnames present). `Button` and `SignupForm` use Tailwind utilities and tokens.

- Guardrails to prevent reintroduction: Partially met
  - Script present and run via `prebuild`.
  - CI workflow file not present.
  - Script scope does not currently scan docs; plan suggested docs scanning.

### Issues found
- Build not verified due to Node version mismatch
  - Local build failed with: Node.js v18.19.0 is not supported by Astro; requires ">=18.20.8".
  - Recommend pinning Node via `engines.node` in `package.json` and adding `.nvmrc` to standardize local/CI Node versions.

- Guardrail script scope narrower than plan
  - Current script checks `package.json`, `yarn.lock`, and for the plugin in `src/styles`, but not `src/` or `docs/` generally. The plan’s example scanned docs as well. Consider broadening or explicitly documenting the intentional exclusion of docs to avoid false positives in historical documents.

- Docs still reference DaisyUI
  - `docs/features/0004_PLAN.md` suggests evaluating DaisyUI usage:

  ```44:47:docs/features/0004_PLAN.md
  - Evaluate `daisyui` usage. If no DaisyUI components are used beyond theme tokens, consider removing the plugin to simplify. Otherwise, keep it strictly for theme variables.
  ```

  - `docs/features/0004_REVIEW.md` mentions DaisyUI as optional:

  ```130:142:docs/features/0004_REVIEW.md
  - **DaisyUI plugin (optional)**: If DaisyUI components aren’t used, you could remove the plugin and keep tokens via `@theme` alone to simplify the stack.
  - Optionally add ESLint Tailwind plugin; optionally remove DaisyUI if unused.
  ```

  - `docs/features/0001_PLAN.md` references DaisyUI and shows a DaisyUI button example:

  ```64:67:docs/features/0001_PLAN.md
  - Components: stick to semantic HTML with DaisyUI/Tailwind utilities; avoid custom components for this scope
  ```

  These should be updated to reflect Tailwind-only usage. Note: The 0005 plan/brief themselves mention “daisyUI” by necessity; if the guardrail is extended to search docs, consider allowlisting those specific files.

### Suggestions (non-blocking)
- Expand the guardrail script to also scan `src` (and optionally `docs` with an allowlist) for the literal term "daisyui" to match the plan’s intent. Document any exclusions.
- Add CI workflow (e.g., GitHub Actions) that runs `corepack enable && yarn install --immutable && yarn check:no-daisyui && yarn build` on PRs.
- Standardize Node version:
  - `package.json` → `"engines": { "node": ">=18.20.8" }`
  - project root → `.nvmrc` with an LTS version known to work (e.g., `20.17.0`).
- Clean up legacy references to DaisyUI in older docs to avoid confusion; adjust examples to pure Tailwind utilities.
- Optional follow-up from prior review: prefer `focus-visible:` utilities over global `*:focus` rules for better UX.

### Acceptance criteria status
- No `daisyui` in `package.json`, `yarn.lock`, or `src/styles/global.css`: Met
- No DaisyUI classnames in components/pages: Met
- Build passes: Not verified due to Node version mismatch (environment). Likely to pass once Node is ≥18.20.8.
- Guardrail script added: Met (scope narrower than plan)
- CI example provided: Not present
- Docs updated to Tailwind-only: Not yet; updates recommended in the files cited above


