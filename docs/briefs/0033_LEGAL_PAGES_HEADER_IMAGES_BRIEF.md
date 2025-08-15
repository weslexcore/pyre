# Legal Pages Header Images

## Project Overview
Add full-width header images to the Privacy Policy, Cookie Policy, and Terms of Service pages to enhance visual appeal and maintain consistency with the site's design aesthetic. The images should span the full width of the page and use images from the available assets that haven't been used elsewhere.

## Target Audience
- Users visiting legal pages for information about privacy, cookies, and terms
- Maintains visual consistency with the overall site design
- Enhances user experience on otherwise text-heavy pages

## Primary Benefits / Features
- **Visual Enhancement**: Adds visual interest to legal pages that are primarily text-based
- **Brand Consistency**: Maintains the site's aesthetic with carefully selected imagery
- **Full-Width Design**: Images span the entire page width for maximum visual impact
- **Asset Utilization**: Makes use of existing high-quality images that haven't been used elsewhere

## High-Level Tech/Architecture
- **Configuration-Driven**: Add header image configuration to existing `src/lib/policies.ts` file
- **Component Structure**: Modify the three legal page components (`privacy-policy.astro`, `cookie-policy.astro`, `terms-of-service.astro`) to include header images
- **Image Selection**: Use available images from `src/assets/images/` that haven't been used elsewhere:
  - `cyano_sweat_logo.jpg` - for Privacy Policy
  - `sky_field.jpeg` - for Cookie Policy  
  - `red_flowers_in_hand.jpeg` - for Terms of Service
- **Responsive Design**: Ensure images work well across all device sizes
- **Performance**: Optimize images for web delivery

## Implementation Details
- Extend the `PolicyDocument` type in `src/lib/types.ts` to include optional `headerImage` property
- Update the policy configurations in `src/lib/policies.ts` to include header image paths
- Modify the legal page components to render the header images above the content
- Ensure proper image optimization and responsive behavior
- Maintain existing content structure and styling
