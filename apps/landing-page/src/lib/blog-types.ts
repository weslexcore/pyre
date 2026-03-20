import type { CollectionEntry } from 'astro:content';
import type { ImageMetadata } from 'astro';

/**
 * Blog post type from content collection
 */
export type BlogPost = CollectionEntry<'blog'>;

/**
 * Blog post data (frontmatter)
 */
export type BlogPostData = BlogPost['data'];

/**
 * Processed blog post with additional computed fields
 */
export interface ProcessedBlogPost {
  id: string;
  data: BlogPostData;
  readingTime: number;
  excerpt?: string;
  body?: string;
}

/**
 * Blog post card data for preview
 */
export interface BlogPostCard {
  slug: string;
  title: string;
  description: string;
  date: Date;
  author: string;
  tags: string[];
  image?: ImageMetadata | string;
  readingTime: number;
}

/**
 * Blog filter state
 */
export interface BlogFilters {
  searchQuery: string;
  selectedTags: string[];
}

/**
 * Tag with count
 */
export interface TagWithCount {
  name: string;
  count: number;
}
