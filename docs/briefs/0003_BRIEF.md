# Mailing List Sign-up + Hero Refactor

## 1) Project overview / description
Add an email sign-up flow to the landing page and refactor the hero for maintainability.
- Place a newsletter sign-up section directly below the hero. It collects an email address and includes supporting copy: “Sign up for our newsletter and stay updated on opening and introductory offers.” Plus a privacy reassurance: “We will only send essential info and tangible offers.”
- Add a “Join the mailing list” button to the top-right of the hero.
- Create a reusable `Button` component for visual consistency across CTAs.
- Extract the hero into its own `Hero` component.

## 2) Target audience
- Prospective members and wellness enthusiasts in/near Richmond, VA
- Early adopters interested in opening updates, promotions, and offers

## 3) Primary benefits / features
- Newsletter block immediately below hero with clear headline, short copy, and single email input field
- Accessible form with proper label, inline validation messaging, and keyboard/focus support
- Submits to existing API endpoint (`/api/subscribe`) using standard form POST (progressive enhancement) and optional JSON fetch
- Top-right hero CTA “Join the mailing list” using the shared `Button` component; anchors/scrolls to the sign-up block
- Consistent styles via reusable `Button` and Tailwind utilities (avoid new global CSS selectors)
- Mobile-first, responsive layout; legible type and adequate spacing

## 4) High-level tech/architecture used
- Astro components: `Hero.astro`, `Button.astro`, `SignupForm.astro`
- Styling with Tailwind utilities per workspace guidelines; keep `global.css` for tokens/resets only
- Form posts to `src/pages/api/subscribe.ts` (already implemented) with server-side email validation and graceful fallback redirect to `/?subscribed=1`
- Optional client-side enhancement (smooth scroll from hero CTA to sign-up, inline validation)
- No third-party email provider integration in this scope; existing API remains stubbed for future provider wiring


