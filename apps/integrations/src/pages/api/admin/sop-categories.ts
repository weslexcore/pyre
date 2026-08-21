// SOP sections (the category headers on /admin/sops), admin-only. Sections are
// rows in `sop_categories`; documents point at them by the free-text
// `sops.category`, so a section exists independently of whether anything is
// filed under it yet — that's what lets an admin add an empty section and then
// create SOPs into it.
//   POST   { name }            — create an empty section, placed last
//   PATCH  { name, newName }   — rename, carrying every document with it
//   DELETE ?name=              — remove an empty section
// Ordering stays in /api/admin/sop-order (the drag handles); this route only
// creates, renames, and removes. CSRF-guarded in-route like every
// cookie-authed mutation (see astro.config.mjs).

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin } from '@/lib/auth/admin';
import { getDb, type SopCategoryRow } from '@/lib/db';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

// Matches the sop_categories check constraint.
const MAX_CATEGORY = 60;

/** Trimmed name, or null when it isn't a usable section name. */
function readName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || name.length > MAX_CATEGORY) return null;
  return name;
}

/** How many documents are filed under `name` (archived ones included). */
async function countSops(
  db: NonNullable<ReturnType<typeof getDb>>,
  name: string
): Promise<{ count: number; error: string | null }> {
  const { count, error } = await db
    .from('sops')
    .select('id', { count: 'exact', head: true })
    .eq('category', name);
  if (error) return { count: 0, error: error.message };
  return { count: count ?? 0, error: null };
}

export const POST: APIRoute = async ({ cookies, request }) => {
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

  const name = readName(body.name);
  if (!name) return json({ error: `name is required (max ${MAX_CATEGORY} chars)` }, 400);

  // A category already in use by documents but with no row of its own sorts
  // last, unranked — creating "it" here just gives it a position, which is
  // harmless. A name that already has a row is a genuine duplicate.
  const { data: existing, error: existingError } = await db
    .from('sop_categories')
    .select('name')
    .eq('name', name)
    .maybeSingle();
  if (existingError) return json({ error: existingError.message }, 500);
  if (existing) return json({ error: `A section named "${name}" already exists` }, 409);

  // Place it last, after every section that already has a position.
  const { data: lastRanked, error: lastError } = await db
    .from('sop_categories')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) return json({ error: lastError.message }, 500);
  const sortOrder = lastRanked ? (lastRanked.sort_order as number) + 1 : 0;

  const { data, error } = await db
    .from('sop_categories')
    .insert({ name, sort_order: sortOrder })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') return json({ error: `A section named "${name}" exists` }, 409);
    return json({ error: error.message }, 500);
  }

  return json({ category: data as SopCategoryRow }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
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

  const name = readName(body.name);
  const newName = readName(body.newName);
  if (!name || !newName) {
    return json({ error: `name and newName are required (max ${MAX_CATEGORY} chars)` }, 400);
  }
  if (name === newName) return json({ error: 'newName must differ from name' }, 400);

  // Refuse to merge two sections by renaming one onto the other — a rename
  // that quietly absorbed another section's documents would be unrecoverable.
  const { count: collisions, error: collisionError } = await countSops(db, newName);
  if (collisionError) return json({ error: collisionError }, 500);
  const { data: rankedCollision, error: rankedError } = await db
    .from('sop_categories')
    .select('name')
    .eq('name', newName)
    .maybeSingle();
  if (rankedError) return json({ error: rankedError.message }, 500);
  if (collisions > 0 || rankedCollision) {
    return json({ error: `A section named "${newName}" already exists` }, 409);
  }

  // Documents first: if the rename fails halfway, the worst case is documents
  // pointing at a name with no row yet — which still renders (unranked, last)
  // rather than vanishing.
  const { error: sopsError } = await db
    .from('sops')
    .update({ category: newName })
    .eq('category', name);
  if (sopsError) return json({ error: sopsError.message }, 500);

  // Carry the position across: delete the old row, insert the new one at the
  // same rank (the primary key is the name, so this can't be an update).
  const { data: existing, error: existingError } = await db
    .from('sop_categories')
    .select('sort_order')
    .eq('name', name)
    .maybeSingle();
  if (existingError) return json({ error: existingError.message }, 500);

  const { error: insertError } = await db
    .from('sop_categories')
    .insert({ name: newName, sort_order: existing ? (existing.sort_order as number) : 0 });
  if (insertError) return json({ error: insertError.message }, 500);

  if (existing) {
    const { error: deleteError } = await db.from('sop_categories').delete().eq('name', name);
    if (deleteError) return json({ error: deleteError.message }, 500);
  }

  return json({ ok: true, name: newName });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const name = readName(url.searchParams.get('name'));
  if (!name) return json({ error: 'name is required' }, 400);

  // Deleting a section must never delete documents. Emptying it first is the
  // admin's decision about where those SOPs belong, not this route's.
  const { count, error: countError } = await countSops(db, name);
  if (countError) return json({ error: countError }, 500);
  if (count > 0) {
    return json(
      {
        error: `"${name}" still has ${count} SOP${count === 1 ? '' : 's'} in it. Move them to another section first.`,
      },
      409
    );
  }

  const { error } = await db.from('sop_categories').delete().eq('name', name);
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
};
