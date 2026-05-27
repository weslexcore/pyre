# Skill: extract a layout into a reusable template

**Use this when:** a layout pattern (e.g. headline + lede + footer card) is needed across multiple posts, or the user explicitly asks for a template. One-off layouts should stay inline in the post's own `style.css` — promote to a template only on the second use, or when explicitly asked.

## What a template is

A template is a folder under `templates/<template-slug>/` containing three files:

```
templates/<template-slug>/
├── template.html    # markup snippet posts copy into their <body>
├── template.css     # structural styles (grid, spacing, type defaults)
└── README.md        # usage instructions + slot table
```

Posts opt in by **linking the CSS** and **copying the HTML snippet** into their body — there's no JS, no build step, no inheritance. It's the simplest form of reuse that works.

The working reference is `templates/product-card/`. Mirror its structure.

## Steps

1. **Pick a slug.** Kebab-case, layout-descriptive (not brand-descriptive). Good: `product-card`, `quote-block`, `stat-callout`. Bad: `summer-launch`, `red-bg`.
2. **Write `template.html`.** The minimal markup snippet a post will copy. Use BEM-style class names prefixed `tpl-<slug>__<slot>`. Add a top-line HTML comment telling authors what to do:
   ```html
   <!-- Copy this block into your post's <body>, replacing the placeholder text. -->
   <section class="tpl-<slug>">
     <div class="tpl-<slug>__body">…</div>
   </section>
   ```
3. **Write `template.css`.** Structural and typographic defaults only. Use brand tokens from `shared/brand.css` (`var(--pyre-creme)`, `var(--font-display)`, `var(--space-8)`). The artboard fills the viewport, so the root template element typically uses `width: 100vw; height: 100vh`. **Leave color and background overrides flexible** — consuming posts will style them.
4. **Write `README.md`.** Two sections: a Usage snippet (the `<link>` + copy steps) and a Slots table (class name → purpose).

## Naming convention

Every class declared by a template must be prefixed `tpl-<slug>__`. This avoids collisions with post-specific selectors and with Tailwind utilities. The product-card template uses `.tpl-product-card`, `.tpl-product-card__eyebrow`, `.tpl-product-card__title`, etc.

## Cascade order matters

Posts link stylesheets in this order: `reset → brand → tailwind → template.css → post style.css`. So:
- A template's `tpl-…` classes win over `tailwind` utilities by default. Posts can append `!` on a Tailwind utility to force-override (`bg-pyre-red!`).
- A post's own `style.css` wins over the template — that's how posts customize.
- Templates should declare *structure* (display, grid, spacing) and *typographic defaults*. Posts override *color, background, imagery*.

## `template.css` patterns to follow

- Use `var(--space-N)` (8 / 16 / 24 / 32 / 48 / 64 / 96 / 128 px) for padding/gaps.
- Use absolute pixel sizes for `font-size` (the artboard is 1080px wide; typography is hand-tuned, not fluid).
- Use `var(--font-display)` / `var(--font-sans)` / `var(--font-mono)` / `var(--font-logo)` — never name a font directly.
- Use `var(--pyre-*)` tokens for colors — never raw hex.

## Templates and `multi-page` / `video` posts

Templates don't care about pages or video. The same template snippet works inside `<section class="page" data-page="1">` and inside `<section class="page" data-page="2">`. CSS animations defined in `template.css` will run during MP4 recording just like any other CSS animation.

## After creating a template

Update at least one existing post (the one that motivated the template) to use it. That validates the slot structure before a second author adopts it. Linking pattern in the post's `index.html`:

```html
<link rel="stylesheet" href="/templates/<template-slug>/template.css" />
```

…and the snippet from `template.html` copied into the `<section class="page" data-page="1">` body.
