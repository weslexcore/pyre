# Logos

Drop Pyre logo files (SVG preferred) into this directory and reference them from posts using paths like `/shared/logos/<filename>`.

The renderer serves this folder via Vite at the same path used in the browser, so anything that works in dev will work in `yarn render`.

- `pyre_logo.svg` — the pine mark in Pyre black. Recolor on dark backgrounds with `filter: brightness(0) invert(1)`.
- `pyre_logo_gold.svg` — the same mark filled with Pyre gold (`#dbb155`), for cards that want a gold accent (e.g. the gift card).
