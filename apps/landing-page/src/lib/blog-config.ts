/**
 * Blog configuration constants
 */

export const BLOG_CONFIG = {
  // Pagination
  postsPerPage: 12,

  // Reading time calculation (words per minute)
  readingSpeed: 225, // Average adult reading speed

  // Search configuration
  search: {
    // Fuse.js search options
    threshold: 0.4, // 0.0 = perfect match, 1.0 = match anything
    keys: ['title', 'description', 'tags'] as const,
    minMatchCharLength: 2,
    ignoreLocation: true,
  } as const,

  // Related posts
  relatedPostsCount: 3,

  // Social sharing
  socialSharing: {
    twitter: true,
    facebook: true,
    linkedin: true,
    copyLink: true,
  },
} as const;
