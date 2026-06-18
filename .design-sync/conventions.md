# Pyre Design System — how to build with it

Import real components from `@pyre/design-system` (loaded at `window.PyreDS.*`). The whole
look comes from one stylesheet, `styles.css`, which is already in the design's import
closure — no provider, no theme wrapper, no setup. If text shows up in a system font or
controls look unstyled, `styles.css` isn't loaded; nothing else is needed to make the
brand appear.

## Styling idiom: props + design tokens (no utility classes)

This DS has **no utility-class vocabulary** to compose with. Style in two ways only:

1. **Component props** carry the design language — `variant`, `size`, `tone`, `level`,
   `display`, `eyebrow`. Reach for these before any custom CSS.
2. **Design tokens** (CSS custom properties from `styles.css`) for your own layout glue.
   Use them in `style={{…}}`; never hardcode hex or px that a token already names.

| Token family | Names |
|---|---|
| Brand colors | `--pyre-red` `--pyre-blue` `--pyre-gold` `--pyre-sage` `--pyre-sky` `--pyre-black` `--pyre-creme` |
| Semantic | `--background` `--foreground` `--primary` `--secondary` `--accent` `--muted` `--border` `--ring` |
| Type | `--font-sans` (Neue Montreal) `--font-mono` (Neue Montreal Mono) `--font-mono-bold` (Fraktion Mono) `--font-logo` (Eckmannpsych — **wordmark only**, see rule below) |
| Spacing (8px scale) | `--space-1`…`--space-16` |
| Radius | `--radius-sm` `--radius-md` `--radius-lg` `--radius-full` |

**Brand rules to keep designs on-brand:** follow the 2-color rule — one ink + one ground
per surface (creme ground / black ink, or invert with the `ink` Card and dark sections).
**`--font-logo` (Eckmannpsych) is the wordmark face — use it ONLY to set the literal word
"PYRE", via the `Logo` component. Never apply it to headings, display text, body copy, or
any other label.** Everywhere else: headings/display are `--font-sans` (Neue Montreal),
body copy is `--font-mono`, labels/buttons are `--font-mono-bold` uppercase.

**The biggest heading (`Heading level={1}`) is always rendered UPPERCASE** — this is baked
into the component; don't fight it. The brand **squiggle** (a red→gold divider wave) sits
under the header of every `Card` (with a `heading`) and `SessionCard` automatically.

## The components

`Button` (variant: primary/secondary/outline/cta, size: sm/md/lg, `href` for links) ·
`Card` (variant: default/ink/elevated, `heading`) · `Badge` (tone: red/blue/gold/sage/outline) ·
`Input` (`label`, `error`) · `Heading` (level 1–4, `eyebrow`; Neue Montreal) ·
`Logo` (the PYRE wordmark — the only Eckmannpsych surface; `size`, inherits color) ·
`ColorPalette` (brand swatch reference) ·
`SessionCard` (domain: `type` Social/Silent/Guided, `time`, `price`, `slotsLeft`).

Read each component's `<Name>.prompt.md` for its full prop contract and `styles.css` for
the exact token values before styling.

## Idiomatic snippet

```tsx
import { Heading, SessionCard, Button } from "@pyre/design-system";

function Schedule() {
  return (
    <section style={{ background: "var(--pyre-creme)", padding: "var(--space-8)" }}>
      <Heading level={2} eyebrow="This week">Book your heat</Heading>
      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
        <SessionCard type="Social" time="Sat · 4:00 PM" price="$45" slotsLeft={6} />
        <SessionCard type="Silent" time="Sun · 7:00 AM" price="$40" slotsLeft={3} />
      </div>
      <Button variant="cta" style={{ marginTop: "var(--space-4)" }}>Become a member</Button>
    </section>
  );
}
```
