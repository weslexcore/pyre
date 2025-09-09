# Legal Pages Header Images - Technical Plan

## Feature Description
Add full-width header images to the Privacy Policy, Cookie Policy, and Terms of Service pages to enhance visual appeal and maintain consistency with the site's design aesthetic. The images will span the full width of the page and use specific images from the available assets that haven't been used elsewhere.

## Files to Modify

### Data Layer Changes
1. **`src/lib/types.ts`**
   - Extend `PolicyDocument` interface to include optional `headerImage` property of type `ImageRef`

2. **`src/lib/policies.ts`**
   - Add `headerImage` property to each policy configuration:
     - `privacyPolicy`: Use `cyano_sweat_logo.jpg`
     - `cookiePolicy`: Use `sky_field.jpeg`
     - `termsOfService`: Use `red_flowers_in_hand.jpeg`

### UI Layer Changes
3. **`src/pages/privacy-policy.astro`**
   - Add header image rendering above the main content
   - Import and use the header image from policy configuration
   - Apply full-width styling with responsive behavior

4. **`src/pages/cookie-policy.astro`**
   - Add header image rendering above the main content
   - Import and use the header image from policy configuration
   - Apply full-width styling with responsive behavior

5. **`src/pages/terms-of-service.astro`**
   - Add header image rendering above the main content
   - Import and use the header image from policy configuration
   - Apply full-width styling with responsive behavior

## Implementation Algorithm

### Phase 1: Data Layer Setup
1. Update `PolicyDocument` type in `src/lib/types.ts`:
   - Add optional `headerImage?: ImageRef` property to the interface
   - This leverages the existing `ImageRef` interface which includes `src`, `alt`, and `ariaLabel` properties

2. Update policy configurations in `src/lib/policies.ts`:
   - Add `headerImage` property to `privacyPolicy` object with `cyano_sweat_logo.jpg`
   - Add `headerImage` property to `cookiePolicy` object with `sky_field.jpeg`
   - Add `headerImage` property to `termsOfService` object with `red_flowers_in_hand.jpeg`
   - Include appropriate `alt` text for accessibility

### Phase 2: UI Implementation
3. Modify each legal page component to render header images:
   - Add conditional rendering of header image above the main content
   - Use full-width container styling (`w-full`) for the image
   - Apply responsive image sizing with appropriate aspect ratio
   - Ensure proper spacing between header image and page content
   - Maintain existing page structure and styling

## Technical Details

### Image Paths
- Privacy Policy: `/src/assets/images/cyano_sweat_logo.jpg`
- Cookie Policy: `/src/assets/images/sky_field.jpeg`
- Terms of Service: `/src/assets/images/red_flowers_in_hand.jpeg`

### Styling Requirements
- Full-width images spanning the entire page width
- Responsive behavior for different screen sizes
- Proper aspect ratio maintenance
- Consistent spacing with existing page layout
- Accessibility compliance with alt text

### Configuration-Driven Approach
- Follows the existing pattern of storing content in `src/lib` configuration files
- Components import and use data from configuration
- Maintains separation of concerns between data and presentation
- Enables easy future updates to header images without component changes
