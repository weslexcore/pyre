# Feature PRD: Deutsche Sauna-Akademie Certification Badge in Footer

## Introduction/Overview

This feature adds the Deutsche Sauna-Akademie (German Sauna Academy) certification badge to the footer of all pages on the landing site. The badge serves as a trust signal, demonstrating Pyre Sauna's commitment to professional standards and expertise in sauna operations as recognized by one of Europe's premier sauna education institutions.

The certification badge will be visually integrated into the footer with a link to the Deutsche Sauna-Akademie website for verification and credibility. This implementation follows accessibility best practices and maintains design consistency with the existing footer layout.

**Goal:** Display professional credentials to build trust with potential customers and differentiate Pyre Sauna through recognized professional certification.

## Goals

1. Display the Deutsche Sauna-Akademie certification badge prominently yet tastefully in the footer
2. Provide a verification pathway through a link to the certification authority's website
3. Maintain visual harmony with the existing footer design system
4. Ensure accessibility with proper alt text for screen readers
5. Optimize the badge image for performance across all devices
6. Create a responsive implementation that scales appropriately on mobile, tablet, and desktop

## User Stories

1. **As a potential customer**, I want to see professional certifications displayed so that I feel confident about the quality and safety of the sauna experience.

2. **As a site visitor**, I want to click the certification badge so that I can verify the credentials and learn more about what the certification means.

3. **As a mobile user**, I want the certification badge to display properly on my device without disrupting the footer layout.

4. **As a screen reader user**, I want appropriate alt text so that I understand what certification is being displayed.

5. **As a marketing team member**, I want the certification prominently displayed so that we can differentiate ourselves from competitors who may not have professional credentials.

## Functional Requirements

### Badge Display

1. The certification badge must be displayed in the footer of all pages on the landing site
2. The badge image source is located at `apps/landing-page/src/assets/logos/sauna_master_cert.png`
3. The badge must have its own dedicated section/container within the footer grid
4. The badge must appear after all existing footer content (Sessions, Resources, Contact, Legal sections)
5. The badge must not interfere with or disrupt existing footer content layout

### Responsive Behavior

6. The badge must use responsive sizing:
   - **Mobile (< 640px):** ~60-80px height - subtle, doesn't dominate limited screen space
   - **Tablet (640px - 1024px):** ~80-100px height - more visible but balanced
   - **Desktop (> 1024px):** ~100-120px height - prominent and professional
7. The badge must scale proportionally maintaining its aspect ratio
8. The badge must be centered within its container on all screen sizes

### Interactivity & Linking

9. The badge must be wrapped in a clickable link element (`<a>` tag)
10. The link must point to the Deutsche Sauna-Akademie website: `https://www.saunameister.de/`
11. The link must open in a new tab (`target="_blank"`)
12. The link must include proper security attributes (`rel="noopener noreferrer"`)
13. The link must have an appropriate `aria-label` for accessibility

### Accessibility

14. The badge image must include descriptive alt text: "Deutsche Sauna-Akademie Certified - Sauna Master Certification"
15. The link must have an accessible label: "View Deutsche Sauna-Akademie certification details (opens in new tab)"
16. The badge container must have appropriate semantic HTML structure
17. Focus states must be clearly visible for keyboard navigation

### Image Optimization

18. The badge must use Astro's `Image` component for automatic optimization
19. The image must be lazy-loaded to improve page performance
20. The image must use `decoding="async"` for non-blocking rendering
21. The image must be optimized for web delivery (compressed, appropriate format)
22. Multiple image sizes should be generated for responsive delivery

### Design Integration

23. The badge must use the existing color scheme (creme text/gold badge on black background)
24. The badge container must have consistent spacing with other footer sections
25. The badge must work visually with the `RepeatingLogoBackground` component used in the footer
26. The badge must maintain visibility against the footer's dark background with overlay

### Configuration

27. Badge link URL should be stored in the footer configuration file (`src/lib/footer.ts`)
28. Badge alt text and aria labels should be centralized in configuration for easy updates
29. Image path should be clearly documented for future maintenance

## Non-Goals (Out of Scope)

1. **No multiple certifications** - This feature only displays the Deutsche Sauna-Akademie badge, not other potential certifications
2. **No hover tooltips** - No additional information overlays on hover (simple link only)
3. **No animation effects** - Badge displays statically, no fade-in, pulse, or other animations
4. **No certification expiration tracking** - No logic to check or display certification validity dates
5. **No certification details modal** - Clicking opens external site, doesn't open an on-site modal
6. **No booking system integration** - Badge appears on landing site only, not in booking system footer
7. **No A/B testing of placement** - Single placement decision, not testing multiple positions

## Design Considerations

### Visual Treatment

The certification badge image is a gold seal with a swan logo on the left side and text reading:
```
Deutsche
Sauna-Akademie
Certified
```

The badge has a black background, which harmonizes well with the existing footer's black background (`var(--pyre-black)`) and creme text (`var(--pyre-creme)`).

### Footer Grid Structure

Current footer structure:
```
[Logo]  [3-column grid: Sessions | Resources | Contact | Legal]
        [Copyright text]
```

New structure will be:
```
[Logo]  [3-column grid: Sessions | Resources | Contact | Legal]
        [Certification Badge - centered in new row]
        [Copyright text]
```

### Placement Rationale

- **After existing content:** Ensures badge doesn't interfere with primary navigation and information
- **Own section:** Gives proper prominence while maintaining visual hierarchy
- **Before copyright:** Maintains copyright as the final element per convention
- **Centered:** Creates visual balance and draws appropriate attention

### Component Reuse

- Use Astro's `Image` component (already used for logo: line 24-32 in Footer.astro)
- Follow existing link patterns for external URLs with proper security attributes
- Maintain consistent spacing patterns from existing footer sections

## Technical Considerations

### Implementation Approach

1. **Update footer configuration** (`src/lib/footer.ts`):
   - Add certification section to config with badge URL, alt text, link href
   - Follow existing pattern of `elements` and `groups` structure

2. **Update Footer component** (`src/components/Footer.astro`):
   - Import badge image asset
   - Add new grid row for certification badge after main footer groups
   - Use Astro `Image` component for optimized delivery
   - Wrap in link element with proper accessibility attributes

3. **Responsive sizing**:
   - Use Tailwind's responsive height utilities: `h-[60px] sm:h-[80px] md:h-[90px] lg:h-[100px] xl:h-[120px]`
   - Use `w-auto` to maintain aspect ratio
   - Use flexbox centering for proper alignment

### File Changes

**Files to modify:**
- `apps/landing-page/src/lib/footer.ts` - Add certification config
- `apps/landing-page/src/components/Footer.astro` - Add badge markup
- `apps/landing-page/src/lib/types.ts` (if needed) - Add TypeScript types for certification config

**Files to reference (no changes):**
- `apps/landing-page/src/assets/logos/sauna_master_cert.png` - Badge image asset

### Performance Impact

- Badge image is ~10-20KB (estimated based on typical badge images)
- Lazy loading ensures no impact on initial page load
- Astro Image optimization will generate WebP/AVIF formats automatically
- Minimal CSS impact (flexbox centering, responsive sizing)
- No JavaScript required

### TypeScript Considerations

Extend `FooterContent` type to include optional certification section:
```typescript
certification?: {
  imageSrc: string;
  imageAlt: string;
  linkHref: string;
  linkAriaLabel: string;
}
```

## Success Metrics

### User Trust & Confidence
- Include certification in pre-booking surveys: measure if customers noticed and valued the certification
- Track conversion rate before/after implementation to see if trust signals impact booking decisions
- Monitor customer feedback mentions of professionalism and credentials

### Technical Performance
- Footer section Core Web Vitals remain unchanged (no LCP/CLS degradation)
- Badge image loads within 500ms on 3G connection
- Lighthouse accessibility score maintains 100/100
- Zero console errors or warnings related to badge implementation

### Engagement (Stretch Metrics)
- Track click-through rate on certification badge link (expect <5% but provides verification pathway)
- Monitor time on site for users who view footer (badge may increase engagement)

### Quality Assurance
- Badge displays correctly on all major browsers (Chrome, Firefox, Safari, Edge)
- Badge scales appropriately on all device sizes (mobile, tablet, desktop)
- Badge maintains proper aspect ratio at all viewport sizes
- Link works correctly and opens in new tab with proper security attributes

## Acceptance Criteria

### Visual
- [ ] Badge displays in footer on all landing site pages
- [ ] Badge appears after existing footer sections (Sessions, Resources, Contact, Legal)
- [ ] Badge is centered in its container
- [ ] Badge scales responsively across mobile, tablet, and desktop viewports
- [ ] Badge maintains visual harmony with existing footer design
- [ ] Badge is visible against dark footer background

### Functional
- [ ] Badge image loads successfully from asset path
- [ ] Badge image is optimized by Astro Image component
- [ ] Badge link opens Deutsche Sauna-Akademie website in new tab
- [ ] Badge link includes security attributes (noopener noreferrer)
- [ ] Badge has appropriate alt text for screen readers
- [ ] Badge link has appropriate aria-label

### Technical
- [ ] Badge configuration is stored in `src/lib/footer.ts`
- [ ] Badge uses Astro Image component per project standards
- [ ] Badge implements lazy loading
- [ ] Badge has async decoding attribute
- [ ] Code follows existing footer patterns and conventions
- [ ] TypeScript types are properly defined (if needed)

### Performance
- [ ] No degradation in Lighthouse performance score
- [ ] No degradation in Lighthouse accessibility score
- [ ] Badge image loads in <500ms on 3G connection
- [ ] No CLS (Cumulative Layout Shift) issues introduced

### Cross-browser & Devices
- [ ] Badge displays correctly in Chrome, Firefox, Safari, Edge
- [ ] Badge is fully functional on iOS Safari and Android Chrome
- [ ] Badge scales properly on iPhone SE (small mobile)
- [ ] Badge scales properly on tablet devices
- [ ] Badge scales properly on 1080p and 4K desktop displays

### Accessibility
- [ ] Badge link is keyboard accessible
- [ ] Focus indicator is clearly visible on keyboard navigation
- [ ] Alt text is read correctly by screen readers
- [ ] Link aria-label provides clear context about new tab behavior

---

**Document Version:** 1.0
**Created:** October 17, 2025
**Status:** Ready for Planning Phase
**Feature Number:** 0050
