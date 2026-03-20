import { BLOG_CONFIG } from './blog-config';
import type { BlogPost } from './blog-types';

/**
 * Find related posts based on shared tags
 * @param currentPost - The current blog post
 * @param allPosts - All available blog posts
 * @returns Array of related posts (up to configured count)
 */
export function getRelatedPosts(currentPost: BlogPost, allPosts: BlogPost[]): BlogPost[] {
  const currentTags = new Set(currentPost.data.tags);
  const currentId = currentPost.id;

  // Calculate relevance score for each post
  const postsWithScores = allPosts
    .filter((post) => {
      // Exclude current post and draft posts
      return post.id !== currentId && !post.data.draft;
    })
    .map((post) => {
      // Count shared tags
      const sharedTags = post.data.tags.filter((tag) => currentTags.has(tag)).length;

      return {
        post,
        score: sharedTags,
      };
    })
    .filter((item) => item.score > 0); // Only include posts with at least one shared tag

  // Sort by score (descending), then by date (newest first)
  postsWithScores.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return b.post.data.date.getTime() - a.post.data.date.getTime();
  });

  // Return top N related posts
  return postsWithScores.slice(0, BLOG_CONFIG.relatedPostsCount).map((item) => item.post);
}
