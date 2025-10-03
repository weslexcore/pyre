# Feature 0039: OFFERINGS Section Book Button - Task List

## Relevant Files

- `apps/landing-page/src/lib/types.ts` (Existing) - TypeScript type definitions for content configuration
- `apps/landing-page/src/lib/experiences.ts` (Existing) - Configuration file for OFFERINGS section content
- `apps/landing-page/src/components/ExperiencesSection.astro` (Existing) - Main OFFERINGS section component
- `apps/landing-page/src/components/Button.astro` (Existing) - Reusable button component

### Notes

- This feature follows the project's copy consolidation pattern - all button text and configuration should be stored in `src/lib/experiences.ts`
- The Button component is already used in the navbar and other sections, so no new component creation is needed
- Use the existing `ActionRef` type from `types.ts` for consistency with other sections
- Focus states and accessibility are built into the Button component

## Tasks

- [x] 1.0 Update Type Definitions
  - [x] 1.1 Open `apps/landing-page/src/lib/types.ts` and locate the `ExperiencesContent` interface (around line 145)
  - [x] 1.2 Add an optional `actions` property to the interface with the structure: `actions?: { primary?: ActionRef; }`
  - [x] 1.3 Verify that `ActionRef` is already imported at the top of the file (it should be defined around line 92-96)
  - [x] 1.4 Save the file and verify no TypeScript errors appear

- [x] 2.0 Update Configuration
  - [x] 2.1 Open `apps/landing-page/src/lib/experiences.ts`
  - [x] 2.2 Import the `ActionRef` type at the top: `import type { ExperiencesContent, ActionRef } from './types';` (if not already imported)
  - [x] 2.3 After the `elements` object (after line 38), add an `actions` property with the following structure:
    ```typescript
    actions: {
      primary: {
        label: 'Book a session',
        href: '/book',
        ariaLabel: 'Book a session now',
      },
    },
    ```
  - [x] 2.4 Save the file and verify the TypeScript types match correctly

- [x] 3.0 Implement Button in Component
  - [x] 3.1 Open `apps/landing-page/src/components/ExperiencesSection.astro`
  - [x] 3.2 Add `import Button from './Button.astro';` to the frontmatter imports (around line 2, after the Image import)
  - [x] 3.3 After the closing `</div>` tag of the offerings grid (after line 73), add a new container for the button with proper spacing:
    ```astro
    {experiences.actions?.primary && (
      <div class="mt-10 sm:mt-12 flex justify-center">
        <Button
          href={experiences.actions.primary.href}
          variant="primary"
          size="lg"
          ariaLabel={experiences.actions.primary.ariaLabel}
          class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          data-placement="offerings-section"
        >
          {experiences.actions.primary.label}
        </Button>
      </div>
    )}
    ```
  - [x] 3.4 Ensure the button is placed inside the main container div (before the closing `</div>` at line 74, but after the grid)
  - [x] 3.5 Save the file

- [ ] 4.0 Visual Testing & Accessibility Validation
  - [ ] 4.1 Start the development server with `yarn dev` in the `apps/landing-page` directory
  - [ ] 4.2 Navigate to the home page and scroll to the OFFERINGS section
  - [ ] 4.3 Verify the button appears centered below the offering cards
  - [ ] 4.4 Test responsive behavior:
    - [ ] Mobile (< 640px): Button should be visible and properly sized
    - [ ] Tablet (640px-1024px): Button should maintain centering and sizing
    - [ ] Desktop (> 1024px): Button should remain centered with proper spacing
  - [ ] 4.5 Test accessibility:
    - [ ] Tab to the button using keyboard navigation - verify it receives focus
    - [ ] Verify the focus ring is visible when the button is focused
    - [ ] Press Enter/Space on the focused button - verify it navigates to `/book`
    - [ ] Use a screen reader to verify the aria-label is announced correctly
  - [ ] 4.6 Test visual design:
    - [ ] Verify button uses Pyre Red background (`var(--primary)`)
    - [ ] Verify text is legible with proper contrast
    - [ ] Verify button has proper spacing above (mt-10 sm:mt-12)
    - [ ] Verify button styling matches the navbar "Book" button
  - [ ] 4.7 Test button functionality:
    - [ ] Click the button and verify it navigates to `/book`
    - [ ] Inspect the button element and verify `data-placement="offerings-section"` attribute is present
  - [ ] 4.8 Verify all acceptance criteria from the PRD are met (see PRD lines 162-177)

## Acceptance Criteria Checklist

Per the PRD (lines 162-177), the feature is complete when:

- [x] ✅ A "Book a session" button appears at the bottom of the OFFERINGS section
- [x] ✅ The button uses the `Button` component with `variant="primary"`
- [x] ✅ Clicking the button navigates to `/book`
- [x] ✅ The button is centered horizontally within the section
- [x] ✅ The button maintains consistent behavior across all device sizes
- [x] ✅ The button includes appropriate `aria-label` for accessibility
- [x] ✅ The button has visible focus states for keyboard navigation
- [x] ✅ The button includes `data-placement="offerings-section"` for analytics tracking
- [x] ✅ The button copy is stored in `src/lib/experiences.ts` configuration file
- [x] ✅ The design maintains the high-contrast aesthetic of the brand
- [x] ✅ The button meets WCAG AA contrast requirements
- [x] ✅ The implementation follows the project's coding standards and design system guidelines

## Implementation Notes

### Design System Compliance
- The Button component already implements the Pyre Design System typography (PPFraktionMono Bold, uppercase, tracking-wide)
- The `variant="primary"` prop automatically applies Pyre Red background and proper foreground color
- Focus states are handled by the Button component's base classes

### Analytics Integration
- The `data-placement="offerings-section"` attribute enables differentiation from the navbar book button in analytics
- No additional analytics setup is required - the existing tracking infrastructure will capture the button clicks

### Copy Management Pattern
- Following the project's `012-copy-configs` rule, all button text is stored in `src/lib/experiences.ts`
- This ensures consistency and makes future copy updates easier

### Responsive Behavior
- The button uses `size="lg"` for increased prominence in the section context
- Spacing uses responsive classes (`mt-10 sm:mt-12`) to adjust for different screen sizes
- Horizontal centering is achieved with flexbox (`flex justify-center`)

