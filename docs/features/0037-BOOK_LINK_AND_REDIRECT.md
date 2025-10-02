## Introduction / Overview

Add a prominent "Book" call-to-action (CTA) across the landing site that routes users to `/book`, which redirects to the external booking platform. This ensures users can quickly initiate a booking from key entry points (header, mobile nav, hero, footer), while we track clicks and centralize configuration for maintainability.

- Primary destination (for now): `https://www.sweatpals.com/host/pyre` ([SweatPals host page](https://www.sweatpals.com/host/pyre))
- Redirect entry point: `/book`
- UTM: `utm_source=pyresauna.com`
- Open behavior: same tab

## Goals

1. Provide a clear, consistent pathway to booking from key areas across the landing site.
2. Centralize the label and destination in copy/config files to simplify future updates.
3. Track user engagement on the "Book" CTA via PostHog to understand performance by placement.
4. Ensure styling consistency with existing design system and the header's "JOIN MAILING LIST" button treatment.

## User Stories

- As a visitor, I want a clear "Book" button visible across the site so I can start the booking process quickly from wherever I am.
- As a marketer, I want UTM parameters on booking traffic so I can attribute traffic and evaluate landing page performance.
- As a product owner, I want analytics on where users click "Book" (header, mobile nav, hero, footer) to inform placement and design.
- As a developer, I want the booking URL and label to live in a central config so changes require no component rewrites.

## Functional Requirements

1. Add a "Book" CTA in the desktop header, styled the same as the existing "JOIN MAILING LIST" button in the header.
2. Add a "Book" item to the mobile navigation menu.
3. Add a "Book" primary CTA in the hero section.
4. Add a "Book" link in the footer.
5. All "Book" CTAs must link to the local route `/book`.
6. Implement `/book` to redirect users to `https://www.sweatpals.com/host/pyre` with `utm_source=landing` appended (if not already present).
   - Use a temporary redirect status (302) by default.
7. All "Book" CTAs must open in the same tab.
8. Instrument PostHog tracking for click events on every "Book" CTA before navigation.
   - Event name: `booking_link_clicked`
   - Event properties: `placement` (one of: `header`, `mobile_nav`, `hero`, `footer`), `page_path`, `final_url`
9. The label text must be exactly `Book`.
10. The label and destination base URL must be stored in landing site's copy/config files, and components must import from there (no hardcoding in components).
11. CTAs must appear site-wide across all landing pages (not only the homepage).
12. Accessibility: each CTA should include an `aria-label` that clearly conveys the action (e.g., "Book now").
13. QA must verify that the redirect works on first click from each placement and that UTM is present in the final URL.

## Non-Goals (Out of Scope)

- No changes to the booking flow UI itself (handled by external provider).
- No A/B testing for label, placement, or style in this iteration.
- No additional UTM parameters beyond `utm_source=landing` unless specified later.
- Do not alter or remove any existing CTAs beyond adding the new "Book" placements.

## Design Considerations (Optional)

- Match the style of the existing header "JOIN MAILING LIST" button for the header treatment.
- Use the project's design system tokens for typography, spacing, and colors to remain on-brand.
- Ensure visual consistency across desktop and mobile treatments.

## Technical Considerations (Optional)

- Copy/Config location: store `label` ("Book") and `bookingBaseUrl` (currently `https://www.sweatpals.com/host/pyre`) in the landing site's `src/lib` config per copy-config rules. Components import from this config.
- Redirect implementation options (choose one that fits hosting/deploy):
  - Add a server/endpoint route at `/book` that issues a 302 to `${bookingBaseUrl}?utm_source=landing` (append only if missing).
  - Or configure a framework/hosting-level redirect (e.g., `vercel.json` or Astro route) to the same effect, ensuring UTM is added.
- Analytics: instrument click handlers with PostHog, avoiding double-fires on navigation; include placement context.
- Performance: ensure no layout shift or CLS from adding buttons/links; maintain responsive layout.

## Success Metrics

- Click-through rate (CTR) on the "Book" CTA by placement (header, mobile nav, hero, footer).
- Number of sessions reaching `/book` and successful redirects to the external provider with correct UTM.
- Increase in bookings attributable to landing page traffic (as available from provider analytics).

## Open Questions

1. Hero treatment: should the "Book" CTA replace an existing primary hero CTA or be added alongside it?
2. Confirm external provider as the long-term destination or if this is temporary.
3. Should we include additional UTM parameters such as `utm_medium` (e.g., `nav`, `hero`, `footer`) and/or `utm_campaign`?
4. Confirm PostHog project/environment and any naming conventions for events/properties.
5. Should we add `aria-label` specifics (e.g., "Book a sauna session") or keep generic?

## References

- Current external booking URL: [SweatPals host page](https://www.sweatpals.com/host/pyre)


