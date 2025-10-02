## Relevant Files

- `apps/landing-page/src/lib/booking.ts` (New) - Centralized booking configuration (label, URL, UTM, aria-label)
- `apps/landing-page/src/lib/types.ts` (Modified) - Added `BookingContent` interface and updated `NavbarContent` interface
- `apps/landing-page/src/components/Navbar.astro` (Modified) - Added Book button to desktop header and mobile menu with Book link
- `apps/landing-page/src/components/Hero.astro` (Modified) - Added Book CTA to hero section
- `apps/landing-page/src/components/Footer.astro` (Modified) - Added Book link to footer with tracking attributes
- `apps/landing-page/src/pages/book.ts` (New) - Server endpoint that redirects to booking URL with UTM
- `apps/landing-page/src/lib/navbar.ts` (Modified) - Added secondary action for Book button
- `apps/landing-page/src/lib/hero.ts` (Modified) - Added primary action for Book CTA
- `apps/landing-page/src/lib/footer.ts` (Modified) - Added Book link to footer groups
- `apps/landing-page/src/components/BookingTracking.astro` (New) - PostHog tracking for all Book CTAs
- `apps/landing-page/src/layouts/main.astro` (Modified) - Added BookingTracking component
- `apps/landing-page/astro.config.mjs` (Modified) - Added Vercel adapter for hybrid rendering to support server endpoint
- `apps/landing-page/package.json` (Modified) - Added @astrojs/vercel dependency

### Notes

- All "Book" CTAs must link to local route `/book` which will handle the redirect
- PostHog tracking must fire before navigation on all CTAs
- Use existing `Button.astro` component for consistency
- Follow copy-config pattern: store all copy in `src/lib` files
- The PRD specifies `utm_source=landing` (not `pyresauna.com`)
- Use 302 temporary redirect status
- Ensure mobile navigation is accessible and follows design system

### Post-Implementation Changes

- Removed Book button from hero section (per user request)
- Changed Book button in header (desktop and mobile) to use `primary` variant (Pyre red color)

## Tasks

- [x] 1.0 Create Booking Configuration
- [x] 2.0 Add Book Button to Desktop Header (Navbar)
- [x] 3.0 Add Mobile Navigation Menu with Book Link
- [x] 4.0 Add Book CTA to Hero Section
- [x] 5.0 Add Book Link to Footer
- [x] 6.0 Create `/book` Redirect Endpoint
- [x] 7.0 Implement PostHog Tracking for All Book CTAs
- [x] 8.0 Update TypeScript Types

