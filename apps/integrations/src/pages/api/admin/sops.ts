// SOP library API for the /admin/sops tool. GET lists the SOPs the caller's
// role may view — plus the section names to group them under, which for admins
// includes sections holding nothing yet (see /api/admin/sop-categories) — or
// one document + its history with ?slug= / ?id=. PUT saves
// a new version (per-document edit grants, optimistic-locked on baseVersion),
// POST / PATCH / DELETE are admin-only: create, change settings (access
// grants, category, archive), and permanently delete an archived document.
// Gated on the /admin/sops page grant; per-document access is a set of roles
// plus individually named staff emails (see lib/sops/levels.ts), resolved
// against the caller's role from getSopRole and their session email.
// Mutations are CSRF-guarded in-route via assertSameOrigin (global checkOrigin
// stays off; see astro.config.mjs).

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin, requirePage } from '@/lib/auth/admin';
import { getDb, type SopRow, type SopVersionRow } from '@/lib/db';
import { countTasks } from '@/lib/sops/checklist';
import {
  canEditSop,
  canViewSop,
  describeGrants,
  effectiveViewGrants,
  isSopRole,
  normalizeEmail,
  SLUG_RE,
  SOP_ROLES,
  type SopRole,
  type SopViewer,
  slugify,
} from '@/lib/sops/levels';
import { type CategoryRank, sectionsInOrder, sortSops } from '@/lib/sops/order';
import { getPeopleNames, listGrantablePeople } from '@/lib/sops/people';
import { getSopRole } from '@/lib/sops/role';
import { countMatches, MAX_QUERY_LENGTH, MIN_QUERY_LENGTH, searchContent } from '@/lib/sops/search';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const PAGE = '/admin/sops';
const MAX_TITLE = 200;
const MAX_CATEGORY = 60;
const MAX_NOTE = 300;
// Generous for a procedure document, small enough to keep payloads sane.
const MAX_CONTENT = 100_000;
// History panel cap — nobody scrolls past this, and it bounds the payload.
const MAX_VERSIONS = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Matches the sops_*_emails_bounded check constraints.
const MAX_GRANT_EMAILS = 100;

/** A role list from a request body, deduped — or null if it isn't one. */
function parseRoles(value: unknown): SopRole[] | null {
  if (!Array.isArray(value)) return null;
  const roles = [...new Set(value)];
  if (!roles.every(isSopRole)) return null;
  return roles;
}

/**
 * An individual-grant email list from a request body, normalized and checked
 * against the roster. Naming someone who isn't on it is always a mistake — a
 * typo, or a departed teammate — and storing it would leave a grant that looks
 * live in the settings panel and matches nobody.
 */
async function parseGrantEmails(
  value: unknown,
  field: string
): Promise<{ emails: string[]; error?: never } | { emails?: never; error: string }> {
  if (!Array.isArray(value)) return { error: `${field} must be an array of staff emails` };
  const emails = [
    ...new Set(
      value.map((entry) => (typeof entry === 'string' ? normalizeEmail(entry) : '')).filter(Boolean)
    ),
  ];
  if (emails.length > MAX_GRANT_EMAILS) {
    return { error: `${field} may name at most ${MAX_GRANT_EMAILS} people` };
  }
  if (emails.length === 0) return { emails };

  const roster = new Set((await listGrantablePeople()).map((person) => person.email));
  const unknown = emails.filter((email) => !roster.has(email));
  if (unknown.length > 0) {
    return { error: `Not on the staff roster: ${unknown.join(', ')}` };
  }
  return { emails };
}

/**
 * Individually granted emails, for anyone who has no business reading the
 * roster. A staffer may open a document without being entitled to a list of
 * which teammates were named on it — the same reason getPeopleNames answers
 * only for emails a response already mentions.
 */
function redactGrantEmails<T extends { view_emails: string[]; edit_emails: string[] }>(
  row: T,
  isAdmin: boolean
): T {
  if (isAdmin) return row;
  return { ...row, view_emails: [], edit_emails: [] };
}

/**
 * The list payload: everything but the (potentially large) markdown body, plus
 * the task count so the library can mark runnable checklists, and the
 * who-can-read summary. That summary is computed here rather than in the
 * island because non-admins get the grant emails redacted and so can't derive
 * it themselves.
 */
function toSummary(
  row: SopRow,
  isAdmin: boolean
): Omit<SopRow, 'content_md'> & { task_count: number; access_label: string } {
  const { content_md, ...rest } = row;
  const grants = effectiveViewGrants(row);
  return {
    ...redactGrantEmails(rest, isAdmin),
    task_count: countTasks(content_md),
    access_label: describeGrants(grants.roles, grants.emails),
  };
}

/**
 * Give `name` a row in `sop_categories` if it doesn't have one, placed last.
 * Filing a document under a section that was only ever implied by other
 * documents is what makes that section real and reorderable; without this a
 * category typed into the create form stays unranked and pinned to the bottom.
 * Best-effort: a failure here doesn't invalidate the document itself.
 */
async function ensureCategory(
  db: NonNullable<ReturnType<typeof getDb>>,
  name: string
): Promise<void> {
  const { data: existing } = await db
    .from('sop_categories')
    .select('name')
    .eq('name', name)
    .maybeSingle();
  if (existing) return;

  const { data: last } = await db
    .from('sop_categories')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  await db
    .from('sop_categories')
    .insert({ name, sort_order: last ? (last.sort_order as number) + 1 : 0 });
}

async function loadSop(
  db: NonNullable<ReturnType<typeof getDb>>,
  ref: { id?: string | null; slug?: string | null }
): Promise<{ sop: SopRow | null; error: string | null }> {
  let query = db.from('sops').select('*');
  if (ref.id) query = query.eq('id', ref.id);
  else if (ref.slug) query = query.eq('slug', ref.slug);
  else return { sop: null, error: null };

  const { data, error } = await query.maybeSingle();
  if (error) return { sop: null, error: error.message };
  return { sop: (data as SopRow) ?? null, error: null };
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const role: SopRole = await getSopRole(gate.user.email ?? null, gate.access);
  // Grants name people by email, so every access check needs both halves.
  const viewer: SopViewer = { role, email: normalizeEmail(gate.user.email) };

  const id = url.searchParams.get('id');
  const slug = url.searchParams.get('slug');

  // Single document + its version history.
  if (id || slug) {
    if (id && !UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);
    const { sop, error } = await loadSop(db, { id, slug });
    if (error) return json({ error }, 500);
    // 404 for both "doesn't exist" and "not allowed to know it exists".
    if (!sop || !canViewSop(viewer, sop)) return json({ error: 'SOP not found' }, 404);

    const { data: versions, error: versionsError } = await db
      .from('sop_versions')
      .select('*')
      .eq('sop_id', sop.id)
      .order('version', { ascending: false })
      .limit(MAX_VERSIONS);
    if (versionsError) return json({ error: versionsError.message }, 500);

    // The settings panel is admin-only and lets the document be refiled and
    // re-granted, so only admins need the sections and the roster to choose
    // from — the roster especially, since it's the whole staff address book.
    let sections: string[] | undefined;
    if (role === 'admin') {
      const { data: ranks, error: ranksError } = await db
        .from('sop_categories')
        .select('name, sort_order');
      if (ranksError) return json({ error: ranksError.message }, 500);
      const { data: used, error: usedError } = await db.from('sops').select('category');
      if (usedError) return json({ error: usedError.message }, 500);
      sections = sectionsInOrder(
        (ranks ?? []) as CategoryRank[],
        (used ?? []) as { category: string }[]
      );
    }

    const grants = effectiveViewGrants(sop);

    return json({
      sop: redactGrantEmails(sop, role === 'admin'),
      // Same summary the library cards carry, for the same reason: a
      // non-admin can't compute it from a redacted row.
      accessLabel: describeGrants(grants.roles, grants.emails),
      versions: (versions ?? []) as SopVersionRow[],
      role,
      canEdit: canEditSop(viewer, sop),
      categories: sections,
      staff: role === 'admin' ? await listGrantablePeople() : undefined,
      // Names for the editors this response names, so the header and history
      // read as people rather than mailbox local parts.
      people: await getPeopleNames([
        sop.updated_by ?? '',
        ...((versions ?? []) as SopVersionRow[]).map((v) => v.edited_by),
      ]),
    });
  }

  // Library listing, filtered to what this role may view and sorted by the
  // admin-managed category order (see /api/admin/sop-order).
  const { data, error } = await db.from('sops').select('*');
  if (error) return json({ error: error.message }, 500);

  const { data: categories, error: categoriesError } = await db
    .from('sop_categories')
    .select('name, sort_order');
  if (categoriesError) return json({ error: categoriesError.message }, 500);

  const visible = ((data ?? []) as SopRow[]).filter((sop) => canViewSop(viewer, sop));
  const ranks = (categories ?? []) as CategoryRank[];
  const sorted = sortSops(visible, ranks);

  // Sections to render headers for. Admins get every section, including ones
  // holding nothing yet — an empty section is a shelf waiting for its SOPs,
  // and hiding it would make "add a section" look like it did nothing. Anyone
  // else only sees sections with a document they may read, so an empty header
  // never hints at documents above their tier.
  const sections =
    role === 'admin'
      ? sectionsInOrder(ranks, (data ?? []) as { category: string }[])
      : sectionsInOrder(ranks, sorted).filter((name) => sorted.some((s) => s.category === name));

  // ?q= searches title + body of the already view-filtered documents, so a
  // snippet can never leak text from a document the caller may not read.
  const q = url.searchParams.get('q')?.trim() ?? '';
  if (q) {
    if (q.length < MIN_QUERY_LENGTH || q.length > MAX_QUERY_LENGTH) {
      return json(
        { error: `q must be between ${MIN_QUERY_LENGTH} and ${MAX_QUERY_LENGTH} characters` },
        400
      );
    }
    const results = sorted
      .map((sop) => {
        const inContent = searchContent(sop.content_md, q);
        const titleMatches = countMatches(sop.title, q);
        return {
          id: sop.id,
          slug: sop.slug,
          title: sop.title,
          category: sop.category,
          archived: sop.archived,
          titleMatch: titleMatches > 0,
          matchCount: inContent.count + titleMatches,
          snippets: inContent.snippets,
        };
      })
      .filter((r) => r.matchCount > 0);
    return json({ results, role, q });
  }

  // The caller's pinned documents (personal; see /api/admin/sop-pins).
  const email = (gate.user.email ?? '').toLowerCase();
  let pins: string[] = [];
  if (email) {
    const { data: pinRows, error: pinsError } = await db
      .from('sop_pins')
      .select('sop_id')
      .eq('user_email', email);
    if (pinsError) return json({ error: pinsError.message }, 500);
    const visibleIds = new Set(sorted.map((s) => s.id));
    pins = (pinRows ?? []).map((p) => p.sop_id as string).filter((id) => visibleIds.has(id));
  }

  return json({
    sops: sorted.map((sop) => toSummary(sop, role === 'admin')),
    categories: sections,
    // The create form grants access at creation time, so it needs the same
    // roster the settings panel does. Admins only, for the same reason.
    staff: role === 'admin' ? await listGrantablePeople() : undefined,
    role,
    pins,
    people: await getPeopleNames(sorted.map((s) => s.updated_by ?? '')),
  });
};

export const POST: APIRoute = async ({ cookies, request }) => {
  // Creating documents (and choosing their access levels) is admin-only.
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

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > MAX_TITLE) {
    return json({ error: `title is required (max ${MAX_TITLE} chars)` }, 400);
  }

  const slug = typeof body.slug === 'string' && body.slug ? body.slug : slugify(title);
  if (!SLUG_RE.test(slug)) {
    return json({ error: 'slug must be lowercase letters, digits, and hyphens' }, 400);
  }

  const category =
    typeof body.category === 'string' && body.category.trim()
      ? body.category.trim().slice(0, MAX_CATEGORY)
      : 'General';

  // Defaults match the column defaults: readable by everyone with the page
  // grant, editable by admins.
  const viewRoles = body.viewRoles === undefined ? SOP_ROLES.slice() : parseRoles(body.viewRoles);
  const editRoles =
    body.editRoles === undefined ? (['admin'] as SopRole[]) : parseRoles(body.editRoles);
  if (!viewRoles || !editRoles) {
    return json({ error: 'viewRoles and editRoles must be staff, shift_lead, or admin' }, 400);
  }

  const viewGrants = await parseGrantEmails(body.viewEmails ?? [], 'viewEmails');
  if (viewGrants.error) return json({ error: viewGrants.error }, 400);
  const editGrants = await parseGrantEmails(body.editEmails ?? [], 'editEmails');
  if (editGrants.error) return json({ error: editGrants.error }, 400);

  const content = typeof body.content === 'string' ? body.content : '';
  if (content.length > MAX_CONTENT) {
    return json({ error: `content is too large (max ${MAX_CONTENT} chars)` }, 400);
  }

  const sortOrder =
    typeof body.sortOrder === 'number' && Number.isInteger(body.sortOrder) ? body.sortOrder : 0;

  // Always the authenticated session's email — never trusted from the body.
  const email = gate.user.email ?? '';

  const { data, error } = await db
    .from('sops')
    .insert({
      slug,
      title,
      content_md: content,
      category,
      view_roles: viewRoles,
      edit_roles: editRoles,
      view_emails: viewGrants.emails,
      edit_emails: editGrants.emails,
      sort_order: sortOrder,
      created_by: email,
      updated_by: email,
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') return json({ error: `An SOP with slug "${slug}" exists` }, 409);
    return json({ error: error.message }, 500);
  }
  const sop = data as SopRow;

  const { error: versionError } = await db.from('sop_versions').insert({
    sop_id: sop.id,
    version: 1,
    title,
    content_md: content,
    edited_by: email,
    change_note: 'Created',
  });
  if (versionError) return json({ error: versionError.message }, 500);

  await ensureCategory(db, category);

  return json({ sop }, 201);
};

export const PUT: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, PAGE);
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

  const id = typeof body.id === 'string' ? body.id : '';
  if (!UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);

  const { sop, error: loadError } = await loadSop(db, { id });
  if (loadError) return json({ error: loadError }, 500);

  const role = await getSopRole(gate.user.email ?? null, gate.access);
  const viewer: SopViewer = { role, email: normalizeEmail(gate.user.email) };
  if (!sop || !canViewSop(viewer, sop)) return json({ error: 'SOP not found' }, 404);
  if (!canEditSop(viewer, sop)) {
    return json({ error: 'You do not have edit access to this SOP' }, 403);
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > MAX_TITLE) {
    return json({ error: `title is required (max ${MAX_TITLE} chars)` }, 400);
  }

  const content = typeof body.content === 'string' ? body.content : null;
  if (content == null || content.length > MAX_CONTENT) {
    return json({ error: `content is required (max ${MAX_CONTENT} chars)` }, 400);
  }

  const changeNote =
    typeof body.changeNote === 'string' && body.changeNote.trim()
      ? body.changeNote.trim().slice(0, MAX_NOTE)
      : null;

  // Optimistic lock: the client says which version it edited. A mismatch means
  // someone saved in between — surface it instead of silently overwriting.
  const baseVersion = body.baseVersion;
  if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion)) {
    return json({ error: 'baseVersion is required' }, 400);
  }
  if (baseVersion !== sop.current_version) {
    return json(
      { error: 'This SOP changed since you opened it. Reload to get the latest version.' },
      409
    );
  }

  if (content === sop.content_md && title === sop.title) {
    return json({ error: 'No changes to save' }, 400);
  }

  const email = gate.user.email ?? '';
  const nextVersion = sop.current_version + 1;

  // Insert the history row first — its (sop_id, version) unique constraint is
  // the race guard: two simultaneous saves can both pass the check above, but
  // only one insert of version N succeeds.
  const { error: versionError } = await db.from('sop_versions').insert({
    sop_id: sop.id,
    version: nextVersion,
    title,
    content_md: content,
    edited_by: email,
    change_note: changeNote,
  });
  if (versionError) {
    if (versionError.code === '23505') {
      return json(
        { error: 'This SOP changed since you opened it. Reload to get the latest version.' },
        409
      );
    }
    return json({ error: versionError.message }, 500);
  }

  const { data, error } = await db
    .from('sops')
    .update({ title, content_md: content, current_version: nextVersion, updated_by: email })
    .eq('id', sop.id)
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ sop: data as SopRow });
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  // Access levels, category, ordering, archive — admin-only settings.
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

  const id = typeof body.id === 'string' ? body.id : '';
  if (!UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);

  const patch: Partial<SopRow> & { updated_by: string } = { updated_by: gate.user.email ?? '' };

  if (body.viewRoles !== undefined) {
    const roles = parseRoles(body.viewRoles);
    if (!roles) return json({ error: 'viewRoles must be staff, shift_lead, or admin' }, 400);
    patch.view_roles = roles;
  }
  if (body.editRoles !== undefined) {
    const roles = parseRoles(body.editRoles);
    if (!roles) return json({ error: 'editRoles must be staff, shift_lead, or admin' }, 400);
    patch.edit_roles = roles;
  }
  if (body.viewEmails !== undefined) {
    const grants = await parseGrantEmails(body.viewEmails, 'viewEmails');
    if (grants.error) return json({ error: grants.error }, 400);
    patch.view_emails = grants.emails;
  }
  if (body.editEmails !== undefined) {
    const grants = await parseGrantEmails(body.editEmails, 'editEmails');
    if (grants.error) return json({ error: grants.error }, 400);
    patch.edit_emails = grants.emails;
  }
  if (body.category !== undefined) {
    if (typeof body.category !== 'string' || !body.category.trim()) {
      return json({ error: 'category must be a non-empty string' }, 400);
    }
    patch.category = body.category.trim().slice(0, MAX_CATEGORY);
  }
  if (body.sortOrder !== undefined) {
    if (typeof body.sortOrder !== 'number' || !Number.isInteger(body.sortOrder)) {
      return json({ error: 'sortOrder must be an integer' }, 400);
    }
    patch.sort_order = body.sortOrder;
  }
  if (body.archived !== undefined) {
    if (typeof body.archived !== 'boolean') {
      return json({ error: 'archived must be a boolean' }, 400);
    }
    patch.archived = body.archived;
  }

  if (Object.keys(patch).length === 1) return json({ error: 'Nothing to update' }, 400);

  const { data, error } = await db
    .from('sops')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: 'SOP not found' }, 404);

  if (patch.category) await ensureCategory(db, patch.category);

  const updated = data as SopRow;
  const grants = effectiveViewGrants(updated);

  // The caller here is always an admin, so the row goes back whole — but the
  // summary comes with it so the document header restates who can read this
  // without a reload.
  return json({
    sop: updated,
    accessLabel: describeGrants(grants.roles, grants.emails),
  });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id || !UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);

  const { sop, error: loadError } = await loadSop(db, { id });
  if (loadError) return json({ error: loadError }, 500);
  if (!sop) return json({ error: 'SOP not found' }, 404);

  // Deleting removes the whole history (cascade), so require the two-step:
  // archive first, then delete. Keeps a stray click from erasing a document.
  if (!sop.archived) {
    return json({ error: 'Archive this SOP before deleting it' }, 400);
  }

  const { error } = await db.from('sops').delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
};
