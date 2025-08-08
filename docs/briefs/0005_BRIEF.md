# UI Consistency & Landing Page Refresh Brief

## 1) Project Overview / Description
We will resolve UI inconsistencies by standardizing on Tailwind CSS with daisyUI for simplified, consistent component styling while preserving Pyre’s brand customization. The scope includes a refreshed, high-contrast landing page that aligns to the Pyre Design System and component usage rules.

Landing page sections:
- Hero Section (primary CTA: sign up for newsletter)
- About Us
- The Offerings (prominent Symbols per `symbol_usage.mdc`)
- Newsletter Signup

All work must align with: `design_system.mdc`, `symbol_usage.mdc`, `component_usage.mdc` and any other relevant rules. Remove or consolidate any outdated, redundant, or conflicting components/styles during the migration.

## 2) Target Audience
- Site visitors exploring Pyre’s offerings (mobile-first experience is extremely important)
- Prospective community members seeking wellness/sauna-related services
- Internal editors who need consistent, easy-to-use components for future content

## 3) Primary Benefits / Features
- Consistent UI: Standardized styling via Tailwind + daisyUI with brand tokens
- Faster iteration: Simpler class usage and well-structured components
- Clear hierarchy: High-contrast Swiss type treatment, golden-ratio scale
- Accessibility: WCAG AA contrast, focus states, keyboard navigation
- Brand fidelity: Strict adherence to Pyre colors, typography, and symbol prominence
- Performance: Astro SSR/SSG, optimized assets, efficient font loading
- Dark mode: Fully supported via design system variables and theming

## 4) High-Level Tech / Architecture
- Framework: Astro for pages/layouts with componentized sections
- Styling: Tailwind CSS + daisyUI (custom theme mapped to Pyre CSS variables)
- Design Tokens: CSS custom properties for colors/spacing/typography (`design_system.mdc`)
- Components: Reusable Astro components with `component_usage.mdc` conventions
- Symbols: Centralized symbol assets and `<Symbol />` usage per `symbol_usage.mdc`
- Forms: Accessible newsletter signup form with visible focus states and ARIA
- Cleanup: Delete or refactor legacy components and styles that violate the new system

## Acceptance Criteria
- Landing page built with the four sections above, matching Pyre’s design system
- Tailwind + daisyUI integrated with a theme reflecting Pyre brand tokens
- Symbols used prominently in Offerings and sized per guidelines
- Newsletter signup accessible and visually consistent with primary CTA in Hero
- Redundant/conflicting files removed; component classes simplified
- Passes accessibility checks for focus, semantic structure, and contrast
