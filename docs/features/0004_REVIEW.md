## 0004 Review — TailwindCSS Migration & Enforcement + Mailing List and Hero

- **Overall**: The migration to Tailwind utilities is largely complete. Hero, Button, and SignupForm use inline utilities; helper classes like `.hero-*`, `.text-scale-*`, and `.kern-*` are removed. Prettier Tailwind plugin is configured and `#signup` CTA/anchor flow works. API logic matches plan.

### Plan compliance
- **Hero (`src/components/Hero.astro`)**: Uses Tailwind for layout, overlay via arbitrary gradient, responsive grid for center band. Typography uses Tailwind with arbitrary sizes; no `.hero-*` or old typography helpers.
- **Signup (`src/components/SignupForm.astro`)**: Copy and ARIA match plan; POST+fetch enhancement present; Button component used.
- **Button (`src/components/Button.astro`)**: Variants map to theme tokens; utilities inline; hover states handled via utilities.
- **Index (`src/pages/index.astro`)**: Header CTA anchors to `#signup`; section order is `<Hero />` then `<SignupForm />`; smooth scroll present in global CSS.
- **Global CSS (`src/styles/global.css`)**: Reduced to tokens, fonts, base resets, and a few font helpers; no `.hero-*` helpers; smooth-scroll kept.
- **Tooling/guardrails**: Prettier with `prettier-plugin-tailwindcss` configured (package.json + .prettierrc). Cursor Tailwind-first rule exists (`.cursor/rules/tailwind_first.mdc`). ESLint Tailwind plugin is not configured (optional per plan).
- **API (`/api/subscribe`)**: Matches algorithm: content-type detection, regex validation, JSON 200/400, 303 redirect for forms.

### Issues found (bugs)
- **Arbitrary color values include an extra `color:` token (invalid Tailwind usage)**
  - Should be `text-[var(--…)]`, `border-[var(--…)]`, `outline-[var(--…)]` without the `color:` prefix.

```21:36:src/components/SignupForm.astro
<section id="signup" class="bg-[var(--card)] text-[color:var(--card-foreground)]">
  <div class="container py-12 sm:py-16">
    <div class="mx-auto max-w-2xl">
      <h2 class="font-primary-semibold tracking-[-0.02em] text-[clamp(1.25rem,4vw,1.618rem)]">Stay in the loop</h2>
      <p class="mt-2">Sign up for our newsletter and stay updated on opening and introductory offers.</p>
      <p class="text-sm text-[oklch(0.55_0.01_60)]">We will only send essential info and tangible offers.</p>
      …
      <input
        …
        class="mt-1 w-full rounded-md border border-[color:var(--input)] bg-[var(--input-bg)] px-3 py-2 text-[color:var(--input-text)] focus:outline-[color:var(--ring)]"
      />
      …
``` 

- Replace with:
  - `text-[var(--card-foreground)]`
  - `border-[var(--input)]`
  - `text-[var(--input-text)]`
  - `focus:outline-[var(--ring)]` (or prefer `focus-visible:outline-[var(--ring)]`)

```33:37:src/components/Button.astro
const variantClasses =
  variant === 'secondary'
    ? 'bg-[var(--secondary)] text-[color:var(--secondary-foreground)] hover:opacity-90'
    : variant === 'outline'
    ? 'border-2 border-[color:var(--primary-foreground)] text-[color:var(--primary-foreground)] bg-transparent hover:bg-[var(--accent)] hover:text-[color:var(--accent-foreground)]'
    : 'bg-[var(--primary)] text-[color:var(--primary-foreground)] hover:opacity-90';
```

- Replace with:
  - `text-[var(--secondary-foreground)]`
  - `border-[var(--primary-foreground)] text-[var(--primary-foreground)]`
  - `hover:text-[var(--accent-foreground)]`
  - `text-[var(--primary-foreground)]`

- **Clamp ordering in Hero appears inverted**
  - `clamp(min, preferred, max)` currently uses `min` > `max` (`2rem` then `1.5rem`), which collapses to the min and prevents fluid scaling.

```21:22:src/components/Hero.astro
<p class="font-primary-semibold tracking-[-0.02em] text-[clamp(2rem,5vw,1.5rem)] sm:text-[2.618rem] sm:justify-self-end uppercase">Self-care.</p>
…
<p class="font-primary-semibold tracking-[-0.02em] text-[clamp(2rem,5vw,1.5rem)] sm:text-[2.618rem] sm:justify-self-start uppercase">Together.</p>
```

- Suggested: `text-[clamp(1.5rem,5vw,2rem)]` (min ≤ max) to preserve intended fluid sizing.

### Suggestions (non-blocking)
- **Focus styles**: Prefer `focus-visible:` utilities over global `*:focus` to avoid showing focus on mouse interactions. For example, swap input `focus:outline-[…]` to `focus-visible:outline-[…]` and consider removing global `*:focus` in favor of Tailwind utilities.
- **ESLint (optional)**: Add `eslint` + `eslint-plugin-tailwindcss` to validate class names and catch arbitrary value mistakes like the `color:` prefix.
- **DaisyUI plugin**: If no DaisyUI components are used, consider removing it and using Tailwind’s `@theme` only. Current usage is limited to tokens; either approach is fine.

### Acceptance checklist status
- **Header CTA → #signup**: Met
- **Signup copy verbatim**: Met
- **No `.hero-*`, `.text-scale-*`, `.kern-*` usage**: Met
- **Prettier class sorting**: Configured
- **Global CSS minimized**: Met

### Actionable fixes
- Remove `color:` from arbitrary color utilities in `SignupForm.astro` and `Button.astro` as noted above.
- Correct `clamp()` ordering in `Hero.astro`.
- Optionally introduce `focus-visible:` and ESLint Tailwind plugin to prevent regressions.
