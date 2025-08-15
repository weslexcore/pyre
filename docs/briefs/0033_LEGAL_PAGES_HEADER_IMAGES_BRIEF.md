# Legal Pages Header Images Brief

## Project Overview
Add header images to the Privacy Policy, Cookie Policy, and Terms of Service pages to enhance visual appeal and maintain consistency with the overall site design. The images should span the full width of the page and be integrated into the existing configuration system.

## Target Audience
- Website visitors accessing legal documentation
- Users seeking transparency about data handling and service terms
- Legal compliance requirements

## Primary Benefits / Features
- **Visual Enhancement**: Adds professional visual appeal to legal pages
- **Brand Consistency**: Maintains design language across all site pages
- **User Experience**: Makes legal pages more engaging and less intimidating
- **Full-Width Display**: Images span the complete width of the page for maximum impact
- **Configuration-Based**: Uses existing policy configuration system for maintainability

## High-Level Tech/Architecture
- **Configuration Extension**: Extend `src/lib/policies.ts` to include header image properties
- **Type System**: Update `PolicyDocument` interface in `src/lib/types.ts` to support header images
- **Component Integration**: Modify legal page components to render header images
- **Image Assets**: Add appropriate header images to `src/assets/images/` directory
- **Responsive Design**: Ensure images work across all device sizes
- **Accessibility**: Include proper alt text and ARIA labels for screen readers

## Implementation Notes
- Follow existing copy configuration patterns from `012-copy-configs` rule
- Use consistent image naming convention for legal page headers
- Ensure images are optimized for web performance
- Maintain existing policy content structure while adding visual elements
