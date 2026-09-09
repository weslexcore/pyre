// Published blog posts for the destination picker, from the landing site's
// public feed. Server-side only (the page shells call it at request time);
// a failed fetch leaves the picker's blog list empty and every other
// destination still works.

import type { BlogPostRef } from './types';

export async function loadBlogPosts(origin: string): Promise<BlogPostRef[]> {
  try {
    const res = await fetch(`${origin}/api/blog-posts.json`);
    if (!res.ok) return [];
    const body = (await res.json()) as { posts?: BlogPostRef[] };
    return Array.isArray(body.posts) ? body.posts : [];
  } catch {
    return [];
  }
}
