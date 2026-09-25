// Reorder controls for the SOP library (admin-only). One PUT accepting either
// or both shapes:
//   { categories: string[] }              — full category order for the index
//                                           page; upserts sop_categories with
//                                           sort_order = array position.
//   { category: string, sopIds: string[] } — full document order within one
//                                           category; sets each sop's
//                                           sort_order to its array position.
// The client always sends the complete order (not a delta), so positions
// self-normalize even if historical sort_orders had gaps or ties. CSRF-guarded
// in-route like every cookie-authed mutation (see astro.config.mjs).

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { dbError, isUuid, json } from '@/lib/http/route';

const MAX_CATEGORY = 60;
// Sanity bounds far above any plausible library size.
const MAX_ITEMS = 200;

export const PUT: APIRoute = async ({ cookies, request }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const hasCategories = body.categories !== undefined;
  const hasSops = body.category !== undefined || body.sopIds !== undefined;
  if (!hasCategories && !hasSops) {
    return json({ error: 'Provide categories and/or category + sopIds' }, 400);
  }

  if (hasCategories) {
    const categories = body.categories;
    if (
      !Array.isArray(categories) ||
      categories.length === 0 ||
      categories.length > MAX_ITEMS ||
      !categories.every(
        (c): c is string => typeof c === 'string' && c.trim().length > 0 && c.length <= MAX_CATEGORY
      ) ||
      new Set(categories).size !== categories.length
    ) {
      return json({ error: 'categories must be a non-empty array of unique names' }, 400);
    }

    const { error } = await db.from('sop_categories').upsert(
      categories.map((name, index) => ({ name, sort_order: index })),
      { onConflict: 'name' }
    );
    if (error) return dbError(error);
  }

  if (hasSops) {
    const category = body.category;
    const sopIds = body.sopIds;
    if (typeof category !== 'string' || !category.trim() || category.length > MAX_CATEGORY) {
      return json({ error: 'category is required with sopIds' }, 400);
    }
    if (
      !Array.isArray(sopIds) ||
      sopIds.length === 0 ||
      sopIds.length > MAX_ITEMS ||
      !sopIds.every((id): id is string => isUuid(id)) ||
      new Set(sopIds).size !== sopIds.length
    ) {
      return json({ error: 'sopIds must be a non-empty array of unique UUIDs' }, 400);
    }

    // Per-row updates (a handful at most); the category filter keeps an id
    // from another category from being silently repositioned. updated_by is
    // left alone — it names the last content/settings editor, not a reorder.
    for (const [index, id] of sopIds.entries()) {
      const { error } = await db
        .from('sops')
        .update({ sort_order: index })
        .eq('id', id)
        .eq('category', category);
      if (error) return dbError(error);
    }
  }

  return json({ ok: true });
};
