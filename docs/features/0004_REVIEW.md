## 0004 Review — TailwindCSS Migration & Enforcement + Mailing List and Hero

- **Overall**: Migration to Tailwind utilities looks complete. `Hero`, `Button`, and `SignupForm` use inline utilities; helper classes like `.hero-*`, `.text-scale-*`, and `.kern-*` are gone. Prettier Tailwind plugin is configured, the header CTA anchors to `#signup`, and the API behavior matches the plan.

### Plan compliance
- **Hero (`src/components/Hero.astro`)**: Uses Tailwind utilities for layout and overlay; responsive grid for the center band; arbitrary sizes for typography. No `.hero-*` helpers.

```20:33:src/components/Hero.astro
      <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-4 text-white sm:text-left text-center">
        <p class="font-primary-semibold tracking-[-0.02em] text-[clamp(1.5rem,5vw,2rem)] sm:text-[2.618rem] sm:justify-self-end uppercase">Self-care.</p>
        <img
          src="/logos/creme/logo.png"
          alt="Pyre Sauna logo"
          width="577"
          height="576"
          class="h-[clamp(20vw,30vw,420px)] w-auto mx-auto"
          loading="eager"
          decoding="async"
        />
        <p class="font-primary-semibold tracking-[-0.02em] text-[clamp(1.5rem,5vw,2rem)] sm:text-[2.618rem] sm:justify-self-start uppercase">Together.</p>
      </div>
```

- **Signup (`src/components/SignupForm.astro`)**: Copy and ARIA match the brief; progressive enhancement via fetch; shared `Button` used.

```6:12:src/components/SignupForm.astro
<section id="signup" class="bg-[var(--card)] text-[var(--card-foreground)]">
  <div class="container py-12 sm:py-16">
    <div class="mx-auto max-w-2xl">
      <h2 class="font-primary-semibold tracking-[-0.02em] text-[clamp(1.25rem,4vw,1.618rem)]">Stay in the loop</h2>
      <p class="mt-2">Sign up for our newsletter and stay updated on opening and introductory offers.</p>
      <p class="text-sm text-[oklch(0.55_0.01_60)]">We will only send essential info and tangible offers.</p>
```

- **Button (`src/components/Button.astro`)**: Variants map to theme tokens; hover states via utilities; sizes consistent.

```32:41:src/components/Button.astro
const variantClasses =
  variant === 'secondary'
    ? 'bg-[var(--secondary)] text-[var(--secondary-foreground)] hover:opacity-90'
    : variant === 'outline'
    ? 'border-2 border-[var(--primary-foreground)] text-[var(--primary-foreground)] bg-transparent hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]'
    : 'bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90';
```

- **Index (`src/pages/index.astro`)**: Header CTA anchors to `#signup`; order is `<Hero />` then `<SignupForm />`; smooth scroll is present in global CSS.

```20:29:src/pages/index.astro
      <div class="ml-auto">
        <Button href="#signup" variant="outline" size="sm" ariaLabel="Join the mailing list">Join the mailing list</Button>
      </div>
    </div>
  </header>

  <main>
    <Hero />
    <SignupForm />
  </main>
```

- **Global CSS (`src/styles/global.css`)**: Focused on tokens, fonts, base layer, and a few font helpers; `.hero-*` helpers removed; smooth scrolling kept.

- **Tooling/guardrails**: Prettier + `prettier-plugin-tailwindcss` configured in `package.json`.

```25:36:package.json
  "devDependencies": {
    "prettier": "^3.3.3",
    "prettier-plugin-astro": "^0.14.1",
    "prettier-plugin-tailwindcss": "^0.6.9"
  },
  "prettier": {
    "plugins": [
      "prettier-plugin-astro",
      "prettier-plugin-tailwindcss"
    ]
  }
```

- **API (`src/pages/api/subscribe.ts`)**: Content-type detection, regex validation, JSON 200/400 for JSON requests, 303 redirect for forms — matches plan.

```3:17:src/pages/api/subscribe.ts
export const POST: APIRoute = async ({ request, redirect }) => {
  try {
    const contentType = request.headers.get('content-type') || '';

    let email = '';
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as { email?: string };
      email = (body.email || '').toString().trim();
    } else {
      const form = await request.formData();
      email = (form.get('email') || '').toString().trim();
    }
```

### Issues found
- **None blocking.** Earlier concerns about `color:` in arbitrary values and inverted `clamp()` are not present in the current code.

### Suggestions (non-blocking)
- **Focus styles**: Prefer `focus-visible:` utilities over global focus rules to avoid outlines on mouse interactions. Global focus styles are currently set here:

```248:259:src/styles/global.css
  /* Focus styles for accessibility */
  *:focus {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  
  /* Button focus styles */
  button:focus,
  a:focus {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
```

  - Suggest using `focus-visible:outline-[var(--ring)]` on interactive elements and removing/reducing the global rules.

- **Consistency: container utility**: `SignupForm` uses `container` while other sections use explicit `max-w-*` containers. Consider standardizing one approach to avoid mixed patterns.

```6:13:src/components/SignupForm.astro
<div class="container py-12 sm:py-16">
  <div class="mx-auto max-w-2xl">
```

- **Custom font helpers**: Components use `font-primary-semibold` from global CSS. Since the base `body` already sets the brand font, consider swapping to Tailwind’s `font-semibold` to reduce custom helpers over time.

- **ESLint (optional)**: Add `eslint` + `eslint-plugin-tailwindcss` for class validation and to catch arbitrary value mistakes early.

- **DaisyUI plugin (optional)**: If DaisyUI components aren’t used, you could remove the plugin and keep tokens via `@theme` alone to simplify the stack.

### Acceptance checklist status
- Header CTA “Join the mailing list” anchors/scrolls to `#signup`: Met
- Signup block copy verbatim: Met
- No `.hero-*`, `.text-scale-*`, `.kern-*` usage; all Tailwind inline: Met
- Prettier sorts Tailwind class lists: Configured
- Global CSS minimized to resets, fonts, tokens: Met

### Actionable follow-ups
- Migrate global focus rules to `focus-visible:` utilities.
- Standardize layout container strategy (`container` vs explicit `max-w-*`).
- Optionally add ESLint Tailwind plugin; optionally remove DaisyUI if unused.
