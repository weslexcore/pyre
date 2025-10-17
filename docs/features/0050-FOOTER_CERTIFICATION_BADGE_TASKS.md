# Task List: Deutsche Sauna-Akademie Certification Badge

**Feature ID:** 0050
**PRD:** [0050-FOOTER_CERTIFICATION_BADGE.md](./0050-FOOTER_CERTIFICATION_BADGE.md)
**Status:** Ready for Implementation
**Generated:** 2025-10-17

---

## Overview

Implement a certification badge in the landing page footer displaying Deutsche Sauna-Akademie "Sauna Master" credentials. The badge will be clickable, link to the certification authority, and follow existing footer patterns for responsive design and accessibility.

---

## High-Level Tasks

- [ ] **1.0 Extend TypeScript types for certification configuration**
- [ ] **2.0 Add certification configuration to footer config**
- [ ] **3.0 Implement certification badge in Footer component**
- [ ] **4.0 Test responsive behavior and accessibility**

---

## Detailed Task Breakdown

### **1.0 Extend TypeScript types for certification configuration**

#### 1.1 Add certification interface to types.ts
- Add `CertificationBadge` interface with required fields:
  - `image: ImageRef` - badge image reference
  - `altText: string` - accessible alt text
  - `title: string` - certification title for aria-label
  - `link: string` - external certification authority link
  - `ariaLabel: string` - descriptive label for screen readers

#### 1.2 Update FooterContent type
- Add optional `certification?: CertificationBadge` field to `FooterContent` interface

**File:** `apps/landing-page/src/lib/types.ts`

---

### **2.0 Add certification configuration to footer config**

#### 2.1 Import certification badge image
- Import badge image from `../assets/logos/sauna_master_cert.png`

#### 2.2 Add certification object to footerConfig
- Add `certification` property with:
  - Image reference (src: imported badge, alt text)
  - Title: "Deutsche Sauna-Akademie Certified Sauna Master"
  - Link: "https://www.deutsche-sauna-akademie.de"
  - Aria label: "Visit Deutsche Sauna-Akademie - Certified Sauna Master credential"

**File:** `apps/landing-page/src/lib/footer.ts`

---

### **3.0 Implement certification badge in Footer component**

#### 3.1 Import Image component (if not already imported)
- Verify `Image` from `astro:assets` is imported

#### 3.2 Add certification badge section below copyright
- Conditional render: only show if `footerConfig.certification` exists
- Wrap in semantic `<div>` with appropriate spacing classes
- Implement as clickable external link with badge image

#### 3.3 Apply responsive styling
- Mobile: 120px width
- Tablet/Desktop: 140px width
- Use Tailwind classes: `w-[120px] md:w-[140px] h-auto`
- Add hover effect: `hover:opacity-80 transition-opacity`

#### 3.4 Implement accessibility features
- External link attributes: `target="_blank"` and `rel="noopener noreferrer"`
- Proper `aria-label` from config
- Image loading: `loading="lazy"` and `decoding="async"`
- Ensure focus states are visible

#### 3.5 Position and spacing
- Add top margin: `mt-6` or `mt-8` for separation from copyright
- Align left to match footer content flow

**File:** `apps/landing-page/src/components/Footer.astro`

---

### **4.0 Test responsive behavior and accessibility**

#### 4.1 Visual testing
- Test on mobile viewport (320px - 768px)
- Test on tablet viewport (768px - 1024px)
- Test on desktop viewport (1024px+)
- Verify badge scales appropriately
- Verify hover states work correctly

#### 4.2 Accessibility testing
- Test keyboard navigation (Tab to badge link, Enter to activate)
- Test with screen reader (VoiceOver/NVDA)
- Verify aria-label is announced correctly
- Verify external link warning is announced
- Check color contrast for surrounding text

#### 4.3 Link functionality testing
- Verify link opens in new tab
- Verify correct URL: https://www.deutsche-sauna-akademie.de
- Verify `noopener noreferrer` security attributes

---

## Files to Modify

### Primary Files
1. `apps/landing-page/src/lib/types.ts` - Add `CertificationBadge` interface and update `FooterContent`
2. `apps/landing-page/src/lib/footer.ts` - Add certification configuration data
3. `apps/landing-page/src/components/Footer.astro` - Render certification badge

### Asset References
4. `apps/landing-page/src/assets/logos/sauna_master_cert.png` - Existing badge image (no changes needed)

---

## Success Criteria

- [ ] Certification badge appears in footer below copyright text
- [ ] Badge displays at correct responsive sizes (120px mobile, 140px desktop)
- [ ] Badge is clickable and opens Deutsche Sauna-Akademie website in new tab
- [ ] All accessibility attributes are properly implemented
- [ ] Badge works with keyboard navigation
- [ ] Screen readers announce badge purpose correctly
- [ ] Hover states provide visual feedback
- [ ] No breaking changes to existing footer functionality

---

## Notes

- Follow existing footer patterns for external links and image optimization
- Maintain consistency with "012-copy-configs" rule (config in `lib/footer.ts`)
- Use Astro's `Image` component for automatic optimization
- Ensure the badge doesn't interfere with existing footer navigation or copyright text

---

## Development Commands

```bash
# Start landing page dev server
yarn dev:landing

# Or using workspace syntax
yarn workspace @pyre/landing-page dev

# Lint and format
yarn lint:landing
yarn format:landing

# Type check
yarn type-check:landing
```

---

**Ready for implementation!**
