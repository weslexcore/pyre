# Blog System Implementation Tasks

## Relevant Files

### New Files Created

- `apps/landing-page/src/content/config.ts` - Content collection schema definition for blog posts with zod validation
- `apps/landing-page/src/content/blog/sauna-health-benefits.md` - Comprehensive blog post about sauna health benefits (1,400+ words)
- `apps/landing-page/src/lib/blog-config.ts` - Blog configuration constants (posts per page, reading speed, search settings, etc.)
- `apps/landing-page/src/lib/reading-time.ts` - Reading time calculation utility based on word count
- `apps/landing-page/src/lib/related-posts.ts` - Related posts algorithm based on tag matching
- `apps/landing-page/src/lib/blog-types.ts` - TypeScript types for blog-specific data structures
- `apps/landing-page/src/components/blog/BlogPostCard.astro` - Preview card component for blog index with image, title, tags, reading time
- `apps/landing-page/src/components/blog/BlogSearch.astro` - Debounced search bar component
- `apps/landing-page/src/components/blog/BlogTags.astro` - Tag display component with clickable tags
- `apps/landing-page/src/components/blog/BlogTagFilter.astro` - Tag filtering UI with active filter display
- `apps/landing-page/src/components/blog/RelatedPosts.astro` - Related posts section showing 3 related posts
- `apps/landing-page/src/components/blog/ReadingTime.astro` - Reading time display component
- `apps/landing-page/src/components/blog/ShareButtons.astro` - Social sharing buttons (Twitter, Facebook, LinkedIn, Copy Link)
- `apps/landing-page/src/pages/blog/index.astro` - Blog index page with search, filters, and infinite scroll
- `apps/landing-page/src/pages/blog/[slug].astro` - Dynamic route for individual blog posts
- `apps/landing-page/src/layouts/blog-post.astro` - Layout for individual blog posts with full typography styling

### Existing Files Modified

- `apps/landing-page/package.json` - Added fuse.js dependency for search functionality
- `apps/landing-page/astro.config.mjs` - Added MDX integration
- `apps/landing-page/src/lib/types.ts` - Added blog-related type exports
- `apps/landing-page/src/lib/navbar.ts` - Added blog navigation link
- `apps/landing-page/src/lib/footer.ts` - Added "Resources" group with blog link
- `apps/landing-page/src/layouts/main.astro` - Added blog-specific SEO meta tags (article OG tags, JSON-LD structured data, canonical URLs)

### Notes

- All new blog components should be placed in `src/components/blog/` subdirectory for organization
- Content collections go in `src/content/blog/` directory
- Follow existing patterns: use `src/lib/` for configuration and utilities
- Use Tailwind-first approach for all styling
- Ensure all images use Astro's Image component
- Follow design system from `@design_system.mdc`

## Tasks

- [ ] 1.0 Configure Astro Content Collections for Blog
  - [x] 1.1 Create `src/content/blog/` directory structure
  - [x] 1.2 Create `src/content/config.ts` and define blog collection schema with zod
  - [x] 1.3 Define frontmatter schema with required fields: title, description, date, author, tags, and optional fields: image, draft
  - [x] 1.4 Verify `@astrojs/mdx` is installed and configured in `astro.config.mjs`
  - [x] 1.5 Create a minimal test blog post to validate schema and collection setup

- [x] 1.0 Configure Astro Content Collections for Blog

- [x] 2.0 Create Blog Configuration and Utilities
  - [x] 2.1 Create `src/lib/blog-config.ts` with constants (posts per page, default reading speed, search options)
  - [x] 2.2 Create `src/lib/blog-types.ts` with TypeScript interfaces for blog data structures
  - [x] 2.3 Implement `src/lib/reading-time.ts` utility to calculate reading time based on word count (~200-250 wpm)
  - [x] 2.4 Implement `src/lib/related-posts.ts` algorithm that finds posts with most shared tags
  - [x] 2.5 Update `src/lib/types.ts` to export blog-related types
  - [x] 2.6 Add type definition for blog post frontmatter and processed blog data

- [x] 3.0 Build Blog Components
  - [x] 3.1 Create `src/components/blog/` directory
  - [x] 3.2 Build `BlogPostCard.astro` component displaying: featured image, title, excerpt, author, date, tags, reading time
  - [x] 3.3 Build `BlogSearch.astro` component with debounced search input field
  - [x] 3.4 Build `BlogTags.astro` component for displaying post tags (clickable for filtering)
  - [x] 3.5 Build `BlogTagFilter.astro` component showing active filters with clear buttons
  - [x] 3.6 Build `ReadingTime.astro` component to display estimated reading time
  - [x] 3.7 Build `RelatedPosts.astro` component showing 3-4 related posts based on shared tags
  - [x] 3.8 (Stretch) Build `ShareButtons.astro` component with Twitter, Facebook, LinkedIn, Copy Link buttons

- [x] 4.0 Implement Blog Index Page with Search and Filtering
  - [x] 4.1 Create `src/pages/blog/index.astro` page
  - [x] 4.2 Implement server-side fetching of all published blog posts using `getCollection('blog')` with draft filtering
  - [x] 4.3 Sort posts in reverse chronological order (newest first)
  - [x] 4.4 Add client-side search functionality using fuse.js (install dependency in package.json)
  - [x] 4.5 Implement infinite scroll using Intersection Observer API (load posts in batches of 12)
  - [x] 4.6 Implement tag filtering UI that works with search
  - [x] 4.7 Add active filter display with ability to clear individual tags or all filters
  - [x] 4.8 Handle empty states (no posts found, no posts yet) with helpful messaging
  - [x] 4.9 Add skeleton/loading states for smooth UX during infinite scroll
  - [x] 4.10 Ensure page follows design system (brand fonts, colors, spacing)
  - [x] 4.11 Ensure fully responsive layout (grid on desktop, single column on mobile)

- [x] 5.0 Implement Individual Blog Post Pages
  - [x] 5.1 Create `src/pages/blog/[slug].astro` with dynamic routing
  - [x] 5.2 Implement `getStaticPaths()` to generate routes for all blog posts
  - [x] 5.3 Create `src/layouts/blog-post.astro` layout for consistent post presentation
  - [x] 5.4 Add post header section with: title, author, publication date, reading time, clickable tags
  - [x] 5.5 Render full MDX content with proper typography (optimal line-length, spacing, hierarchy)
  - [x] 5.6 Style markdown elements: headings, paragraphs, lists, blockquotes, code blocks, tables, links
  - [x] 5.7 Add RelatedPosts component at bottom of post
  - [x] 5.8 Ensure featured image displays if present in frontmatter
  - [x] 5.9 Ensure fully responsive design optimized for reading on mobile
  - [x] 5.10 Apply design system typography (PPNeueMontreal for text, proper line height for readability)

- [x] 6.0 Add SEO and Social Media Optimization
  - [x] 6.1 Add comprehensive Open Graph meta tags to blog post layout: og:title, og:description, og:image, og:url, og:type (article)
  - [x] 6.2 Add article-specific OG tags: article:published_time, article:author, article:tag (all tags)
  - [x] 6.3 Add Twitter Card meta tags: twitter:card (summary_large_image), twitter:title, twitter:description, twitter:image
  - [x] 6.4 Implement canonical URL generation for each blog post
  - [x] 6.5 Add structured data (JSON-LD) for Article schema with proper markup
  - [x] 6.6 Ensure blog index page has appropriate meta description and title
  - [x] 6.7 Verify sitemap generation includes all blog posts (test `sitemap()` integration)
  - [x] 6.8 Test social media previews with Open Graph preview tools

- [x] 7.0 Create Initial Blog Post Content
  - [x] 7.1 Write comprehensive blog post (1,000-1,500 words) about sauna health benefits
  - [x] 7.2 Cover key topics: cardiovascular health, detoxification, mental wellness, muscle recovery
  - [x] 7.3 Add proper frontmatter with all required fields (title, description, date, author, tags)
  - [x] 7.4 Include appropriate tags (e.g., "health", "wellness", "sauna-benefits")
  - [x] 7.5 Add 2-3 relevant images (ensure they're optimized and placed in `src/assets/images/blog/`)
  - [x] 7.6 Use rich markdown formatting: headings, lists, blockquotes, emphasis
  - [x] 7.7 (Optional) Embed a YouTube or Vimeo video about sauna benefits
  - [x] 7.8 Test post rendering, reading time calculation, and social preview
  - [x] 7.9 Verify post appears on blog index and renders correctly

- [x] 8.0 Update Site Navigation and Sitemap
  - [x] 8.1 Update `src/lib/navbar.ts` to add "Blog" navigation link
  - [x] 8.2 Update `src/lib/footer.ts` to add blog link in appropriate footer group (create "Resources" or "Learn" group)
  - [x] 8.3 Verify sitemap automatically includes blog posts (test build output)
  - [x] 8.4 Test navigation from homepage to blog and back
  - [x] 8.5 Ensure blog link is properly styled and responsive in navbar
  - [x] 8.6 Verify all blog URLs follow the pattern `/blog/[slug]`

