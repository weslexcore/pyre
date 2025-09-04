# Health and Safety Content Technical Plan

## Feature Description

Transform the existing placeholder health and safety page into a comprehensive guide that ensures guest safety, sets clear expectations, and creates a welcoming yet responsible environment. The content will establish Pyre as a professional, safety-conscious wellness destination while maintaining the warm, welcoming brand experience. The page will include comprehensive safety framework, clear behavioral guidelines, accessibility and inclusivity information, and operational excellence details.

## Files to Modify/Create

### Content Configuration
- **src/lib/healthSafety.ts** - New file containing all health and safety content using the existing PolicyDocument pattern from policies.ts

### Page Implementation  
- **src/pages/health-and-safety.astro** - Update existing placeholder page to use the new content structure, following the same pattern as privacy-policy.astro

### Asset Selection
- **src/assets/images/sauna_ladle.jpeg** - Use as header image to represent sauna safety and protocols

## Content Structure Algorithm

### Content Organization Pattern
Following the established PolicyDocument pattern from `src/lib/policies.ts`:

1. **Document Structure**: Use PolicyDocument interface with title, effectiveDate, headerImage, intro, and sections array
2. **Section Organization**: Each major content area becomes a PolicySection with heading, paragraphs, and lists
3. **List Formatting**: Use PolicyList for structured information like protocols, guidelines, and procedures
4. **Progressive Disclosure**: Start with essential safety info, expand to detailed guidelines

### Content Sections Implementation
1. **Welcome Introduction** - Intro paragraph setting tone and commitment to safety
2. **Essential Health Guidelines** - PolicySection with lists for pre-visit health checks and medical considerations
3. **Facility Protocols** - PolicySection with structured lists for each area (sauna, cold plunge, steam rooms)
4. **Hygiene Standards** - PolicySection with lists for showering, swimwear, and cleanliness requirements
5. **Behavioral Expectations** - PolicySection covering respect, noise levels, and personal space
6. **Emergency Procedures** - PolicySection with structured emergency response protocols
7. **Reservation Information** - PolicySection covering booking, cancellation, and check-in details
8. **Contact and Support** - PolicySection with contact methods for questions and feedback

### Page Rendering Pattern
Follow the exact same implementation pattern as `src/pages/privacy-policy.astro`:

1. **Header Image**: Conditional rendering with overflow hidden and max-height constraints
2. **Typography Hierarchy**: H1 for page title, H2 for section headings, H3 for list titles
3. **Date Display**: Conditional rendering for effective date and last updated
4. **Content Structure**: Map through sections with paragraphs and lists
5. **Spacing System**: Consistent margin classes (mt-6, mt-10, etc.) following established patterns
6. **List Styling**: Use `list-disc pl-6 space-y-2` for structured information
7. **Container**: Use `mx-auto max-w-screen-md px-4 py-16` for consistent page layout

## Implementation Approach

### Phase 1: Content Creation
- Create `src/lib/healthSafety.ts` with complete content structure
- Define healthAndSafety constant following PolicyDocument interface
- Include all content sections with proper paragraph and list organization
- Add effective date and header image configuration

### Phase 2: Page Implementation
- Update `src/pages/health-and-safety.astro` to import and render health safety content
- Follow exact pattern from privacy-policy.astro for layout and styling
- Import sauna_ladle.jpeg for header image
- Configure proper SEO metadata using title and intro content

### Integration Points

- **Cross-link with FAQ page** for common questions about safety
- **Connect to contact page** for specific health inquiries  
- **Link to mission page** to reinforce Pyre's wellness philosophy
- **Reference legal pages** for liability and terms of service

## Accessibility and Design System Compliance

### Typography
- Use PPNeueMontreal (font-primary-semibold) for headings
- Maintain proper heading hierarchy (h1 → h2 → h3)
- Apply consistent line-height and spacing

### Color and Contrast
- Use established color system (Pyre Black text on Pyre Creme background)
- Maintain WCAG AA contrast ratios
- Follow high-contrast philosophy for important safety information

### Responsive Design
- Use established container system with max-widths
- Ensure mobile-first responsive behavior
- Maintain consistent padding and margins across breakpoints

### Semantic Structure
- Use proper semantic HTML elements (main, section, h1-h3, ul, li)
- Include aria-labels where appropriate
- Maintain logical content flow for screen readers

## Content Consolidation Strategy

Following the established pattern from `src/lib/policies.ts`, all health and safety content will be centralized in `src/lib/healthSafety.ts`. This approach:

- **Enables easy content updates** without touching page layout code
- **Follows established project patterns** for maintainability  
- **Supports future internationalization** if needed
- **Separates content from presentation** for clean architecture
- **Allows content reuse** across multiple components if needed

## SEO and Meta Configuration

- **Page Title**: "Health & Safety | Pyre Sauna"
- **Meta Description**: Use intro content for search engine descriptions
- **Header Image**: Optimized sauna_ladle.jpeg with proper alt text
- **Structured Content**: Proper heading hierarchy for search indexing