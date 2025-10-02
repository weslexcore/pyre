# Feature PRD: Blog System for Landing Site

## Introduction/Overview

This feature adds a full-featured blog system to the landing site, allowing the team to publish content about sauna health benefits, wellness tips, and other relevant topics. The blog will support rich media content (images, videos, text, embeds) and be optimized for social media sharing to drive traffic and engagement.

Blog posts will be created as Markdown files in the codebase, making them easy to version control and manage through the standard development workflow. The system prioritizes discoverability through search and filtering, social sharing capability, and a smooth reading experience.

**Goal:** Create a content marketing platform that drives awareness, educates potential customers about sauna benefits, and improves SEO through regular, shareable content.

## Goals

1. Enable the team to publish rich, multimedia blog content without requiring a CMS
2. Make blog posts easily discoverable through search and tag-based filtering
3. Optimize all blog content for social media sharing (Open Graph, Twitter Cards)
4. Provide readers with a seamless, engaging reading experience with infinite scroll
5. Help readers find related content through intelligent post suggestions
6. Track content performance through reading time estimates and analytics
7. Maintain design consistency with the existing landing page design system

## User Stories

1. **As a content creator**, I want to write blog posts in Markdown so that I can focus on content without worrying about complex formatting or CMS interfaces.

2. **As a reader**, I want to browse all blog posts with infinite scroll so that I can discover content without clicking through multiple pages.

3. **As a reader**, I want to search for specific topics so that I can quickly find relevant information.

4. **As a reader**, I want to filter posts by tags/categories so that I can explore content about specific topics that interest me.

5. **As a marketing team member**, I want blog posts to have rich social media preview cards so that shared links are engaging and drive click-throughs.

6. **As a reader**, I want to see related posts at the end of an article so that I can continue learning about topics that interest me.

7. **As a reader**, I want to see how long an article will take to read so that I can decide if I have time to read it now or save it for later.

8. **As a reader**, I want to share blog posts directly on social media so that I can easily share valuable content with my network.

9. **As a site owner**, I want direct, permanent URLs for each blog post so that I can link to them in email campaigns and social media.

10. **As a reader on mobile**, I want the blog to look beautiful and be easy to read on any device.

## Functional Requirements

### Content Management

1. Blog posts must be written in Markdown files stored in the codebase (e.g., `apps/landing-page/src/content/blog/`)
2. Each Markdown file must support frontmatter metadata including:
   - `title` (required)
   - `description` (required, for SEO and previews)
   - `date` (required, ISO format)
   - `author` (required, string)
   - `tags` (required, array of strings)
   - `image` (optional, featured image for post and social sharing)
   - `draft` (optional, boolean to hide unpublished posts)
3. Post content must support rich media including:
   - Images with captions
   - Embedded videos (YouTube, Vimeo, or self-hosted)
   - Code blocks with syntax highlighting
   - Block quotes
   - Callouts/info boxes
   - Links and citations
   - Lists (ordered and unordered)
   - Tables
4. The system must support MDX to enable interactive components if needed

### Blog Index Page (`/blog`)

5. Must display all published blog posts (non-draft) in reverse chronological order (newest first)
6. Must implement infinite scroll that automatically loads more posts as the user scrolls down
7. Each post preview card must display:
   - Featured image (if available)
   - Title
   - Excerpt/description
   - Author name
   - Publication date
   - Tags
   - Reading time estimate
8. Must include a search bar that filters posts by title, description, and content in real-time
9. Must include tag/category filter UI that allows users to select one or more tags to filter posts
10. Must show active filters with the ability to clear them
11. Must handle empty states gracefully (no posts found, no posts yet)

### Individual Blog Post Pages (`/blog/[slug]`)

12. Must render each blog post at a clean URL: `/blog/[slug]` where slug is derived from the filename or frontmatter
13. Must display full post content with proper typography and spacing following the design system
14. Must include a header section showing:
    - Title
    - Author name
    - Publication date
    - Reading time estimate
    - Tags (clickable, filtering to that tag)
15. Must include a "Related Posts" section at the bottom showing 3-4 similar posts based on shared tags
16. Must be fully responsive and optimized for mobile reading

### Social Media & Sharing

17. Must generate comprehensive Open Graph meta tags for each post:
    - `og:title`
    - `og:description`
    - `og:image` (post's featured image)
    - `og:url`
    - `og:type` (article)
    - `article:published_time`
    - `article:author`
    - `article:tag` (all tags)
18. Must generate Twitter Card meta tags:
    - `twitter:card` (summary_large_image)
    - `twitter:title`
    - `twitter:description`
    - `twitter:image`
19. Must include canonical URLs for SEO
20. **Stretch Goal:** Include social sharing buttons (Twitter, Facebook, LinkedIn, Copy Link) on each post

### Analytics & Performance

21. Must calculate and display estimated reading time based on word count (assume ~200-250 words per minute)
22. Must integrate with existing analytics to track page views per post
23. Must suggest related posts based on shared tags (posts with most tag overlap appear first)
24. Must optimize images for web delivery (responsive images, lazy loading)
25. Must achieve good Core Web Vitals scores (LCP, FID, CLS)

### SEO

26. Must generate appropriate meta descriptions from post frontmatter
27. Must create an XML sitemap including all blog posts
28. Must use semantic HTML (article, header, time elements)
29. Must implement proper heading hierarchy (h1 for title, h2/h3 for sections)

## Non-Goals (Out of Scope)

1. **No user commenting system** - This is explicitly out of scope per requirements
2. **No user accounts or authentication** - Blog is read-only for visitors
3. **No CMS backend** - Content management happens through code/markdown
4. **No author profile pages** - Authors are shown by name only, no dedicated pages
5. **No newsletter subscription specific to blog** - Use existing email signup
6. **No post reactions/likes** - No user interaction beyond reading and sharing
7. **No RSS feed** - Not in initial scope (can be added later if needed)
8. **No multi-language support** - English only initially
9. **No content scheduling** - Posts go live when merged to main branch

## Design Considerations

### Design System Compliance

- Must use existing design system from `@design_system.mdc`
- Must use brand fonts and sizing per memory [7684086]
- Must follow Tailwind-first approach per `@tailwind_first` rule
- Must use Astro Image component for all images per memory [7684081]
- Blog post cards should follow similar visual language to existing landing page sections
- Typography should prioritize readability (appropriate line height, max-width for content)

### Component Structure

Suggested components to create:
- `BlogPostCard.astro` - Preview card for blog index
- `BlogPost.astro` - Full post layout
- `BlogSearch.astro` - Search and filter UI
- `BlogTags.astro` - Tag display and filtering
- `RelatedPosts.astro` - Related posts section
- `ShareButtons.astro` - Social sharing (stretch goal)
- `ReadingTime.astro` - Reading time calculator/display

### Responsive Behavior

- Blog index: Grid layout on desktop (2-3 columns), single column on mobile
- Blog post: Centered column with optimal reading width (~65-75 characters per line)
- Images: Full width within content column, responsive
- Videos: Responsive embed containers (16:9 aspect ratio maintained)

## Technical Considerations

### Astro Integration

- Use Astro's Content Collections API for type-safe frontmatter and content management
- Define collection schema in `src/content/config.ts`
- Leverage Astro's static site generation for optimal performance
- Use `getCollection()` and `getEntry()` for querying posts

### Search Implementation

- Client-side search using Fuse.js or similar lightweight library
- Index post titles, descriptions, and potentially full content
- Debounce search input for performance
- Consider generating search index at build time

### Infinite Scroll

- Implement using Intersection Observer API
- Load posts in batches (e.g., 12 posts per load)
- Maintain scroll position and state in URL query params for back-button support
- Consider skeleton loading states for smooth UX

### Performance

- Lazy load images below the fold
- Optimize featured images (generate multiple sizes)
- Code split the search functionality (only load when needed)
- Preload critical fonts
- Minimize JavaScript bundle size

### File Structure

Suggested structure:
```
apps/landing-page/
  src/
    content/
      blog/
        config.ts          # Content collection schema
        example-post.md    # Blog posts
    components/
      blog/                # Blog-specific components
    pages/
      blog/
        index.astro        # Blog index page
        [slug].astro       # Individual post page
    lib/
      blog-config.ts       # Blog settings (posts per page, etc.)
      reading-time.ts      # Reading time calculation
      related-posts.ts     # Related posts algorithm
```

## Success Metrics

### Traffic & Engagement
- Achieve 1,000 unique visitors to blog within first 3 months
- Average time on page >2 minutes for blog posts
- Bounce rate <60% on blog pages
- 20%+ click-through rate on related posts

### Social Sharing
- 10%+ of blog visitors share content on social media
- Blog posts account for 30%+ of social media referral traffic within 6 months

### SEO Impact
- Blog posts ranking in top 10 for target keywords within 3 months
- 25%+ increase in organic search traffic to landing site
- Generate backlinks from health/wellness publications

### Content Production
- Publish at least 2 blog posts per month consistently
- Maintain average reading time of 5-8 minutes per post (1,000-2,000 words)

## Open Questions

1. **Video hosting:** Should videos be self-hosted or rely on YouTube/Vimeo embeds?
2. **Image management:** What's the preferred workflow for optimizing and storing blog images (src/assets vs public folder)?
3. **Draft preview:** Do we need a way to preview draft posts locally before publishing?
4. **Content workflow:** Should there be a review process for blog posts before they're merged?
5. **Tag taxonomy:** Should we maintain a controlled vocabulary of tags, or allow free-form tagging?
6. **Archive/older posts:** How should very old posts be handled? Keep indefinitely, archive, or sunset?
7. **Analytics integration:** Which analytics platform are we using? (Google Analytics, Plausible, etc.)
8. **Schema.org markup:** Should we add structured data (Article schema) for rich search results?

## Initial Content Requirement

As part of the initial implementation, create **one placeholder blog post** with the following specifications:
- **Topic:** Benefits of sauna on health
- **Content:** Comprehensive article covering key health benefits (cardiovascular health, detoxification, mental wellness, muscle recovery, etc.)
- **Format:** Include a mix of text, at least 2-3 images, and optionally a video embed
- **Length:** ~1,000-1,500 words (5-7 minute read)
- **Metadata:** Proper frontmatter with all required fields, appropriate tags (e.g., "health", "wellness", "sauna-benefits")
- **Purpose:** Serve as a template/example for future blog posts and validate the blog system functionality

---

**Document Version:** 1.0  
**Created:** October 2, 2025  
**Status:** Ready for Planning Phase

