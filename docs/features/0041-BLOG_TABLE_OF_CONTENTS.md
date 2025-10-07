# 0041 - Blog Table of Contents Component

## Introduction/Overview

Create an interactive table of contents (TOC) component for blog pages that automatically generates navigation based on H2 headers in markdown content. The component will improve user experience by allowing quick navigation through long-form content, showing reading progress, and adapting to different screen sizes. On desktop, it will appear as a sticky sidebar on the left, while on mobile it will be an expandable panel at the top of the post.

## Goals

1. **Improve Content Navigation**: Enable users to quickly jump to specific sections of blog posts
2. **Enhance Reading Experience**: Provide visual feedback on reading progress and current section
3. **Increase User Engagement**: Encourage users to explore more content sections through easy navigation
4. **Responsive Design**: Deliver optimal experience across desktop and mobile devices
5. **Automatic Implementation**: Work seamlessly across all blog posts without manual configuration

## User Stories

1. **As a blog reader on desktop**, I want to see a sticky table of contents on the left side of long articles so that I can quickly navigate to sections that interest me most.

2. **As a mobile blog reader**, I want to access a collapsible table of contents at the top of articles so that I can see the post structure and jump to relevant sections without endless scrolling.

3. **As a content consumer**, I want to see which section I'm currently reading highlighted in the table of contents so that I can track my progress through the article.

4. **As a user scanning content**, I want smooth scrolling when clicking TOC links so that I can maintain context and orientation within the article.

5. **As a returning reader**, I want the table of contents to show my reading progress so that I know how much content remains.

## Functional Requirements

1. **Automatic Header Detection**: The system must automatically scan blog post content and extract all H2 headers to generate the table of contents.

2. **Responsive Layout**: The component must display as a sticky sidebar on the left side of content on desktop screens and as an expandable panel at the top of posts on mobile devices.

3. **Smooth Navigation**: The system must provide smooth scrolling animation when users click on table of contents links.

4. **Current Section Highlighting**: The component must highlight the currently visible section in the table of contents as users scroll through the content.

5. **Reading Progress Indicator**: The system must show visual progress indication (both highlighting and progress bar/indicator) to show how far through the content the user has progressed.

6. **Universal Deployment**: The table of contents must be automatically enabled on all blog posts without requiring manual configuration.

7. **Mobile Expandable Interface**: On mobile, the component must provide a "Table of Contents" button that reveals a slide-down panel with navigation options.

8. **Sticky Positioning**: On desktop, the table of contents must follow the user's scroll position while remaining visible and accessible.

9. **Accessibility Support**: The component must include proper ARIA labels, keyboard navigation support, and screen reader compatibility.

10. **Performance Optimization**: The table of contents generation and scroll tracking must not negatively impact page load times or scrolling performance.

## Non-Goals (Out of Scope)

1. **Manual TOC Configuration**: Will not support manual enabling/disabling per post via frontmatter
2. **H3/H4+ Header Support**: Will not include headers beyond H2 level in the initial implementation
3. **Custom TOC Styling Per Post**: Will not support post-specific styling overrides
4. **Print-Friendly TOC**: Will not optimize table of contents for print layouts
5. **TOC Search Functionality**: Will not include search within the table of contents
6. **TOC Export Features**: Will not support exporting or sharing the table of contents separately

## Design Considerations

### Desktop Layout
- **Position**: Sticky positioned on the left side of the content area
- **Styling**: Clean, minimal design that complements the existing blog layout
- **Width**: Fixed width that doesn't interfere with main content readability
- **Scroll Behavior**: Remains visible as user scrolls, with smooth transitions

### Mobile Layout
- **Trigger**: "Table of Contents" button at the top of the post content
- **Panel**: Slide-down panel that reveals TOC when expanded
- **Interaction**: Tap to expand/collapse, with clear visual indicators
- **Positioning**: Above the main content but below any post metadata

### Visual Indicators
- **Current Section**: Highlighted with distinct color/styling
- **Progress Indicator**: Visual progress bar or percentage indicator
- **Hover States**: Interactive feedback for all clickable elements
- **Typography**: Consistent with existing site typography system

## Technical Considerations

1. **Framework Integration**: Must integrate seamlessly with Astro 5 static site generation
2. **Markdown Processing**: Should work with existing markdown processing pipeline
3. **JavaScript Requirements**: Minimal JavaScript footprint for scroll tracking and smooth scrolling
4. **CSS Framework**: Use Tailwind CSS v4 for styling consistency
5. **Performance**: Implement intersection observer for efficient scroll tracking
6. **Component Architecture**: Create as reusable Astro component with React islands for interactivity
7. **Browser Compatibility**: Support modern browsers with graceful degradation
8. **SEO Impact**: Ensure table of contents doesn't negatively impact SEO or page structure

## Success Metrics

1. **User Engagement**: Increase average time spent on blog posts by 15%
2. **Navigation Usage**: Track clicks on TOC links to measure adoption
3. **Content Completion**: Increase percentage of users who scroll to the end of articles by 20%
4. **Mobile Experience**: Improve mobile blog page bounce rate by 10%
5. **Performance Metrics**: Maintain page load times under 2 seconds with TOC component active
6. **Accessibility Score**: Achieve and maintain 100% accessibility score for blog pages

## Open Questions

1. **Header Styling**: Should the table of contents display the exact header text or truncated versions for long headers?
2. **Empty TOC Handling**: How should the component behave on posts with no H2 headers or very few sections?
3. **Anchor Link Generation**: What URL fragment format should be used for deep linking to sections?
4. **Animation Duration**: What is the optimal smooth scroll duration for good UX without feeling slow?
5. **Mobile Breakpoint**: At what exact screen width should the component switch between desktop and mobile layouts?
6. **Integration Testing**: What existing blog posts should be used for testing the component across different content lengths and structures?