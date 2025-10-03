# Feature 0039: OFFERINGS Section Book Button

## Introduction/Overview

Add a "Book a session" call-to-action button at the bottom of the OFFERINGS section on the landing page. This button will provide users with a direct path to the booking system without requiring them to scroll back to the navigation bar, reducing friction in the user journey and increasing booking conversions.

The button should mirror the styling and behavior of the existing navbar "Book" button, but be adapted to fit seamlessly within the OFFERINGS section's design aesthetic.

## Goals

1. **Increase Conversion Rate**: Make it easier for users to book after learning about the offerings, increasing the likelihood they'll complete a booking
2. **Reduce Friction**: Eliminate the need for users to scroll back up to the navbar to access booking functionality
3. **Improve User Experience**: Provide a natural next step after users have reviewed the available offerings
4. **Maintain Design Consistency**: Ensure the button follows brand guidelines and complements the existing design system

## User Stories

1. **As a potential customer**, I want to easily book a session after reading about the offerings, so that I can quickly reserve my spot without searching for a booking link.

2. **As a mobile user**, I want a prominent booking button near the offerings information, so that I don't have to navigate back to the top of the page to book.

3. **As a first-time visitor**, I want a clear call-to-action after learning about the services, so that I know exactly how to proceed with booking.

## Functional Requirements

1. **Button Placement**: The "Book" button must be placed at the bottom of the OFFERINGS section (`ExperiencesSection.astro`), centered and positioned after all offering cards have been displayed.

2. **Button Styling**: The button must use the same color scheme as the navbar "Book" button (primary variant) but may be adapted in size or prominence to fit the OFFERINGS section design. It should:
   - Use the existing `Button` component from `src/components/Button.astro`
   - Use the `variant="primary"` prop to match the navbar button's color scheme
   - Maintain brand consistency with the design system (Pyre Red background, appropriate contrast)
   - Be visually prominent but harmonious with the OFFERINGS section aesthetic

3. **Button Text**: The button must display "Book a session" text (matching the navbar button) or similar appropriate call-to-action copy.

4. **Button Action**: When clicked, the button must navigate to `/book` (same destination as the navbar "Book" button), which redirects users to the booking system.

5. **Responsive Behavior**: The button must maintain the same behavior and functionality across all device sizes (mobile, tablet, desktop) without variation.

6. **Accessibility**: The button must:
   - Include an appropriate `aria-label` for screen readers
   - Be keyboard navigable
   - Have visible focus states
   - Maintain WCAG AA contrast ratios

7. **Tracking**: The button should include appropriate data attributes to enable analytics tracking and differentiate it from the navbar book button (e.g., `data-placement="offerings-section"`).

## Non-Goals (Out of Scope)

1. Adding individual "Book" buttons to each offering card
2. Creating a booking modal or inline booking form
3. Modifying the existing navbar "Book" button
4. Adding multiple CTAs throughout the OFFERINGS section
5. Implementing different button behaviors for different device sizes
6. Creating a new button component (use existing `Button.astro`)
7. Changing the booking system or `/book` endpoint behavior

## Design Considerations

### Component Usage
- Use the existing `Button.astro` component located at `src/components/Button.astro`
- Apply `variant="primary"` to match the navbar button's styling
- Consider using `size="lg"` for increased prominence in the section
- Add custom classes via the `class` prop if needed for positioning

### Visual Integration
- The button should be centered horizontally within the OFFERINGS section
- Maintain appropriate spacing above and below the button (following the design system's spacing scale)
- Ensure the button stands out as the primary action in the section without overwhelming the offering cards
- The button background should use `var(--primary)` (Pyre Red) per the design system
- Text should use `var(--primary-foreground)` for proper contrast

### Color Scheme
Following the Pyre Design System:
- Background: Pyre Red (`rgb(241, 88, 54)`) via `--primary`
- Text: Appropriate contrasting color via `--primary-foreground`
- Maintain the 2-color maximum rule (the OFFERINGS section already uses Pyre Black and Pyre Creme)

### Typography
- Use the existing Button component's typography (PPFraktionMono Bold, uppercase, tracking-wide)
- Ensure font sizing is appropriate for the section context

## Technical Considerations

### Implementation File
- **Primary File**: `apps/landing-page/src/components/ExperiencesSection.astro`
- **Component**: Import and use `Button.astro` component

### Configuration
- Button copy should be stored in the experiences configuration file (`src/lib/experiences.ts`) following the project's copy consolidation pattern
- Add an `action` property to the `ExperiencesContent` type in `src/lib/types.ts` if not already present

### Example Implementation Structure
```typescript
// In src/lib/experiences.ts
const experiences: ExperiencesContent = {
  elements: {
    title: 'OFFERINGS',
    items: [...],
  },
  action: {
    label: 'Book a session',
    href: '/book',
    ariaLabel: 'Book a session now',
  },
};
```

### Analytics Integration
- Add `data-placement="offerings-section"` attribute for tracking
- Ensure the button can be distinguished from navbar book button in analytics

## Success Metrics

### Primary Metric
1. **Booking Conversion Rate**: Measure the percentage increase in completed bookings after the button is added
   - Baseline: Current booking conversion rate from landing page visitors
   - Target: Measurable increase in booking conversion rate (to be defined based on baseline data)

### Secondary Metrics
1. **Click-Through Rate**: Track the percentage of users who click the OFFERINGS section book button
2. **Button Engagement**: Compare click rates between navbar book button and OFFERINGS section book button
3. **User Flow**: Analyze whether users are more likely to book after viewing the OFFERINGS section

### Measurement Approach
- Use existing analytics platform to track button clicks via `data-placement` attribute
- Compare booking conversion rates before and after feature deployment
- A/B testing may be conducted to validate impact

## Open Questions

1. **Button Size**: Should the button use `size="lg"` for increased prominence, or match the navbar's `size="sm"`?
   - Recommendation: Use `size="lg"` for greater visibility in the section context

2. **Spacing**: What is the desired vertical spacing above and below the button?
   - Recommendation: Follow the existing section padding patterns (e.g., `mt-8 mb-6` or `mt-10 mb-8` on larger screens)

3. **Animation**: Should the button have any entrance animation or scroll-triggered effect?
   - Recommendation: Start without animation; evaluate based on user feedback

4. **Alternative Copy**: Should the button text exactly match "Book a session" or use contextual copy like "Book your experience"?
   - Recommendation: Use "Book a session" for consistency with navbar

5. **Tracking Implementation**: What specific analytics events should be fired when this button is clicked?
   - Recommendation: Work with analytics team to define event structure

## Dependencies

- Existing `Button.astro` component
- Design system CSS custom properties
- Analytics/tracking infrastructure (for measuring success metrics)
- Experiences configuration file structure (`src/lib/experiences.ts`)

## Timeline Estimate

- **Implementation**: 1-2 hours
- **Testing**: 30 minutes
- **Analytics Setup**: 30 minutes
- **Total**: ~2-3 hours

## Acceptance Criteria

The feature is considered complete when:

1. ✅ A "Book a session" button appears at the bottom of the OFFERINGS section
2. ✅ The button uses the `Button` component with `variant="primary"`
3. ✅ Clicking the button navigates to `/book`
4. ✅ The button is centered horizontally within the section
5. ✅ The button maintains consistent behavior across all device sizes
6. ✅ The button includes appropriate `aria-label` for accessibility
7. ✅ The button has visible focus states for keyboard navigation
8. ✅ The button includes `data-placement="offerings-section"` for analytics tracking
9. ✅ The button copy is stored in `src/lib/experiences.ts` configuration file
10. ✅ The design maintains the high-contrast aesthetic of the brand
11. ✅ The button meets WCAG AA contrast requirements
12. ✅ The implementation follows the project's coding standards and design system guidelines

