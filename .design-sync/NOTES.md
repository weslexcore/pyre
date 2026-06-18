# design-sync notes — @pyre/design-system

This design system was **authored fresh** from the Pyre brand foundations (it is not a
pre-existing component library). Source lives in `packages/design-system/`.

## Shape: storybook
- This DS syncs in **storybook shape** (`cfg.shape: "storybook"`). The stories in
  `packages/design-system/src/*.stories.tsx` are the single source of truth — design-sync
  generates previews from them and verifies each against the reference storybook render.
- Reference storybook is built to `.design-sync/sb-reference` (gitignored). Rebuild it when
  stories or DS source change:
  `corepack yarn workspace @pyre/design-system exec storybook build -o <repo>/.design-sync/sb-reference`
- `cfg.storybookConfigDir` = `packages/design-system/.storybook`; `cfg.storybookStatic` =
  `.design-sync/sb-reference` (both cwd-relative, run converter from repo root).
- Known build warn: `! preview decorator bundle failed: No loader for ".woff2"` — the
  Storybook `preview.tsx` imports `styles.css`, which `@font-face`-references woff2 files.
  Benign: the decorator only adds a cosmetic font wrapper; components are styled via the
  shipped `_ds_bundle.css`, so previews render correctly and match the reference. Not new.
- `.design-sync/previews/` is intentionally EMPTY — in storybook shape, previews come from
  the stories. Only add an owned `previews/<Name>.tsx` to override a specific story preview.

## Build
- The DS package has no `node_modules` of its own; React 19 resolves from the repo root.
  Run the converter with `--node-modules ./node_modules` and
  `--entry packages/design-system/dist/index.js`.
- `cfg.buildCmd` = `node build.mjs && tsc -p tsconfig.build.json` (esbuild ESM bundle +
  tsc declaration emit). Run it from `packages/design-system/` before re-syncing if the
  source changed.
- Converter deps (esbuild, ts-morph, @types/react) install into `.ds-sync/` (gitignored).

## Styling model
- `styles.css` (package root) is the single shipped stylesheet: `@font-face` (5 brand
  families, woff2 in `packages/design-system/fonts/`), `:root` tokens, and all component
  classes (`pyre-*`). It is `cfg.cssEntry`. Components reference these classes; there is
  no CSS-in-JS, so `_ds_bundle.css` is empty by design.
- The `pyre-*` classes are component-internal. The design agent styles via component
  **props** + the **CSS custom-property tokens** (`var(--pyre-*)`, `var(--space-*)`,
  `var(--font-*)`), not by reusing internal class names.

## Known render warns
- `[GRID_OVERFLOW]` on Card, Logo, SessionCard → resolved with
  `cfg.overrides.<Name> = {"cardMode": "column"}` (cards are wider than a grid cell). Not new.

## Fixes applied during authoring
- `Logo` originally hardcoded `color: var(--foreground)` (black), so its `OnInk` story
  rendered invisible on the dark ground. Changed `.pyre-logo` to `color: inherit` so the
  wordmark adopts its context color, matching the documented behavior.

## Brand rule: Eckmannpsych is wordmark-only
- `--font-logo` (Eckmannpsych) may ONLY render the literal word "PYRE", via the `Logo`
  component. It is not a usable app/display font. Enforced by removing it everywhere else:
  the `Heading` `display` prop was removed, and `.pyre-session__type` was repointed from
  `--font-logo` to `--font-sans`. If a future component reaches for `--font-logo`, that's a
  brand violation unless it's the wordmark.

## Brand rules baked into components
- **Biggest heading uppercase:** `.pyre-heading--1` (Heading `level={1}`) forces
  `text-transform: uppercase`.
- **Squiggle on card headers:** the brand divider wave (`src/Squiggle.tsx`, internal — not
  an index export) renders under `Card`'s heading and `SessionCard`'s header. It's an
  inline SVG sine wave with a red→gold gradient, ported from
  `apps/landing-page/public/svg/*/divider-squiggle.svg`. Uses `React.useId()` for unique
  gradient ids so multiple instances on a page don't collide.

## Re-sync risks (what can go stale)
- Preview content (`.design-sync/previews/*.tsx`) hardcodes realistic sauna copy/prices —
  cosmetic only, safe to leave.
- If new components are added to `packages/design-system/src/index.ts`, they ship as floor
  cards until a preview is authored for them.
- The 7-color palette in `ColorPalette.tsx` (the component default) duplicates the brand
  hexes; if brand colors change in `styles.css`, update the component default too.
