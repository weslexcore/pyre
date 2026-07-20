// Public list of published blog posts (slug + title only), regenerated at
// build time. Consumed by the integrations admin's UTM Assist tool, which
// can't read this app's content collection cross-app.

import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';

export const prerender = true;

export const GET: APIRoute = async () => {
  const now = new Date();
  const posts = (await getCollection('blog'))
    .filter((p) => p.data.draft !== true && p.data.date <= now)
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime())
    .map((p) => ({ slug: p.id, title: p.data.title }));

  return new Response(JSON.stringify({ posts }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
