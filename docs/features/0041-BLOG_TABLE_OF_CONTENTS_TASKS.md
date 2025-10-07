## Relevant Files

- `apps/landing-page/src/components/TableOfContents.astro` (New) - Main table of contents component with responsive layout and header detection.
- `apps/landing-page/src/components/TableOfContents.test.ts` (New) - Unit tests for TableOfContents component.
- `apps/landing-page/src/components/TOCScrollTracker.tsx` (New) - React island for scroll tracking and intersection observer functionality.
- `apps/landing-page/src/components/TOCScrollTracker.test.tsx` (New) - Unit tests for TOCScrollTracker React component.
- `apps/landing-page/src/layouts/blog-post.astro` (Existing) - Blog post layout that will integrate the table of contents component.
- `apps/landing-page/src/lib/toc-utils.ts` (New) - Utility functions for header extraction, anchor generation, and TOC data processing.
- `apps/landing-page/src/lib/toc-utils.test.ts` (New) - Unit tests for TOC utility functions.
- `apps/landing-page/src/lib/toc-types.ts` (New) - TypeScript interfaces and types for table of contents data structures.
- `apps/landing-page/src/styles/global.css` (Existing) - Global styles that may need TOC-specific styling additions.

### Notes

- Unit tests should typically be placed alongside the code files they are testing (e.g., `TableOfContents.astro` and `TableOfContents.test.ts` in the same directory).
- Use `npx jest [optional/path/to/test/file]` to run tests. Running without a path executes all tests found by the Jest configuration.

## Tasks

- [x] 1.0 Create Table of Contents Core Component
  - [x] 1.1 Create TypeScript interfaces for TOC data structures (headers, sections, progress)
  - [x] 1.2 Build utility functions for automatic H2 header detection and anchor link generation
  - [x] 1.3 Create main TableOfContents Astro component with responsive layout structure
  - [x] 1.4 Implement desktop sticky sidebar positioning and styling
  - [x] 1.5 Implement mobile expandable panel interface with toggle functionality
  - [x] 1.6 Add smooth scrolling navigation between sections
  - [x] 1.7 Create unit tests for utility functions and component logic
- [x] 2.0 Implement Scroll Tracking and Progress Indicators
  - [x] 2.1 Create React island component for intersection observer scroll tracking
  - [x] 2.2 Implement current section highlighting based on viewport position
  - [x] 2.3 Add reading progress indicator (progress bar or percentage display)
  - [x] 2.4 Optimize scroll event performance with throttling and intersection observers
  - [x] 2.5 Handle edge cases (no headers, single header, very short content)
  - [x] 2.6 Create unit tests for scroll tracking functionality
- [x] 3.0 Integrate Component into Blog Post Layout
  - [x] 3.1 Modify blog-post.astro layout to include TableOfContents component
  - [x] 3.2 Implement responsive positioning logic (desktop vs mobile layouts)
  - [x] 3.3 Ensure TOC integration doesn't break existing blog post styling
  - [x] 3.4 Add proper spacing and layout adjustments for TOC placement
  - [x] 3.5 Test integration across different blog post content lengths and structures
- [x] 4.0 Add Interactive Features and Accessibility
  - [x] 4.1 Implement comprehensive ARIA labels and semantic HTML structure
  - [x] 4.2 Add keyboard navigation support (tab order, enter/space activation)
  - [x] 4.3 Ensure screen reader compatibility with proper announcements
  - [x] 4.4 Create smooth animations and transitions consistent with existing design system
  - [x] 4.5 Add hover and focus states following established design patterns
  - [x] 4.6 Implement mobile touch interactions for expandable panel
- [x] 5.0 Testing and Performance Optimization
  - [x] 5.1 Test component across multiple existing blog posts with varying content structures
  - [x] 5.2 Verify performance impact on page load times and scrolling performance
  - [x] 5.3 Test responsive behavior across different screen sizes and devices
  - [x] 5.4 Ensure cross-browser compatibility (modern browsers with graceful degradation)
  - [x] 5.5 Validate accessibility compliance using automated testing tools
  - [x] 5.6 Test integration with existing blog features (search, tags, related posts)