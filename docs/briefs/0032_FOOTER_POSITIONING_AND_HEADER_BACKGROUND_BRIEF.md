# Footer Positioning and Header Background Brief

## Project Overview
Implement sticky footer positioning and conditional header background styling to ensure consistent layout across all pages of the Pyre website.

## Target Audience
- Website visitors across all pages
- Developers maintaining the site layout
- Design team ensuring visual consistency

## Primary Benefits / Features

### Footer Positioning
- **Sticky Footer**: Footer element will always appear at the bottom of the viewport, even when page content is insufficient to push it down
- **Consistent Layout**: Eliminates awkward spacing issues on pages with minimal content
- **Better UX**: Provides a more professional and polished appearance across all pages

### Header Background
- **Conditional Styling**: Header will have black background enabled by default on all pages except the main landing page
- **Visual Hierarchy**: Maintains the special hero treatment for the landing page while providing clear navigation on other pages
- **Brand Consistency**: Ensures the header is always visible and readable across different page backgrounds

## High-Level Tech/Architecture
- **CSS Flexbox/Grid**: Implement sticky footer using flexbox layout with min-height: 100vh
- **Conditional Classes**: Use page-specific classes or route-based styling to control header background
- **Responsive Design**: Ensure footer positioning works across all device sizes
- **Astro Components**: Modify existing Footer.astro and Navbar.astro components to support new layout requirements
