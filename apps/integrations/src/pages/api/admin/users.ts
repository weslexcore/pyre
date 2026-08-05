// Dashboard access management for /admin/users: list, add, edit, and revoke
// dashboard_users rows (the source of truth for who may use the admin, which
// replaced the env allowlists). Admin-only on every method, CSRF-guarded on
// mutations. Guards: an admin can't demote or delete themselves, and the last
// admin row can't be demoted or deleted — dashboard revocations must never
// strand the dashboard without an admin.

import type { APIRoute } from 'astro';
import { ADMIN_TOOLS, SCHEDULE_MANAGE } from '@/components/admin/adminTools';
import {
  type DashboardUserRow,
  getEnvAllowlist,
  invalidateAccessCache,
  listDashboardUsers,
} from '@/lib/auth/access';
import { assertSameOrigin, requireAdmin } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { findMemberByEmail } from '@/lib/momence/host-api';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

// Tool hrefs plus the schedule manage capability (see adminTools.ts).
const GRANTABLE_PAGES = new Set([...ADMIN_TOOLS.map((t) => t.href), SCHEDULE_MANAGE]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parsePages(value: unknown): string[] | Response {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((p) => typeof p !== 'string')) {
    return json({ error: 'pages must be an array of page hrefs' }, 400);
  }
  const pages = [...new Set(value as string[])];
  const unknown = pages.filter((p) => !GRANTABLE_PAGES.has(p));
  if (unknown.length > 0) {
    return json({ error: `Unknown pages: ${unknown.join(', ')}` }, 400);
  }
  // schedule:manage implies the schedule view grant — keep rows consistent.
  if (pages.includes(SCHEDULE_MANAGE) && !pages.includes('/admin/schedule')) {
    pages.push('/admin/schedule');
  }
  return pages;
}

async function gateMutation(
  cookies: Parameters<APIRoute>[0]['cookies'],
  request: Request
): Promise<{ email: string } | Response> {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  return { email: (gate.user.email ?? '').toLowerCase() };
}

/** True when `row` is the only admin row in the table. */
function isLastAdmin(rows: DashboardUserRow[], row: DashboardUserRow): boolean {
  return row.is_admin && rows.filter((r) => r.is_admin).length === 1;
}

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const users = await listDashboardUsers(true);
  if (users === null) return json({ error: 'Storage unavailable' }, 503);

  // Env-allowlisted emails without a dashboard_users row, so the legacy
  // ADMIN_EMAILS / STAFF_EMAILS entries stay visible and importable. Whether
  // they actually grant access depends on the bootstrap rule (only while the
  // table has no admin row) — envActive tells the UI which wording to use.
  const envUsers = getEnvAllowlist().filter((e) => !users.some((u) => u.email === e.email));

  return json({
    users,
    envUsers,
    envActive: !users.some((u) => u.is_admin),
    self: (gate.user.email ?? '').toLowerCase(),
    // 'env' means the caller is still on the bootstrap allowlist — the UI
    // shows a nag to add themselves as the first admin row.
    source: gate.access.source,
  });
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await gateMutation(cookies, request);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const email = String(body.email ?? '')
    .trim()
    .toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: 'Invalid email' }, 400);

  const isAdmin = body.isAdmin === true;
  const pages = parsePages(body.pages);
  if (pages instanceof Response) return pages;
  if (!isAdmin && pages.length === 0) {
    return json({ error: 'Grant at least one page, or admin access' }, 400);
  }

  // Best-effort Momence lookup: users sign in with their Momence account, so
  // the email must match their Momence login. A miss doesn't block the add —
  // staff logins aren't always host members — but the UI surfaces it.
  let displayName: string | null = null;
  let momenceMemberId: number | null = null;
  let momenceMatch = false;
  try {
    const member = await findMemberByEmail(email);
    if (member) {
      momenceMatch = true;
      displayName = `${member.firstName ?? ''} ${member.lastName ?? ''}`.trim() || null;
      momenceMemberId = member.id;
    }
  } catch (e) {
    console.warn('[users] Momence lookup failed:', e instanceof Error ? e.message : e);
  }

  const { data, error } = await db
    .from('dashboard_users')
    .insert({
      email,
      is_admin: isAdmin,
      pages,
      display_name: displayName,
      momence_member_id: momenceMemberId,
      added_by: gate.email,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') return json({ error: `${email} already has access` }, 409);
    return json({ error: error.message }, 500);
  }

  invalidateAccessCache();
  return json({ user: data as DashboardUserRow, momenceMatch }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const gate = await gateMutation(cookies, request);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const id = String(body.id ?? '');
  if (!id) return json({ error: 'Missing id' }, 400);

  const rows = (await listDashboardUsers(true)) ?? [];
  const row = rows.find((r) => r.id === id);
  if (!row) return json({ error: 'No such user' }, 404);

  const fields: Partial<Pick<DashboardUserRow, 'is_admin' | 'pages'>> = {};

  if (body.isAdmin !== undefined) {
    const isAdmin = body.isAdmin === true;
    if (!isAdmin && row.email === gate.email) {
      return json({ error: 'You cannot remove your own admin access' }, 400);
    }
    if (!isAdmin && isLastAdmin(rows, row)) {
      return json({ error: 'Cannot demote the last admin' }, 400);
    }
    fields.is_admin = isAdmin;
  }

  if (body.pages !== undefined) {
    const pages = parsePages(body.pages);
    if (pages instanceof Response) return pages;
    fields.pages = pages;
  }

  if (Object.keys(fields).length === 0) return json({ error: 'Nothing to update' }, 400);

  const willBeAdmin = fields.is_admin ?? row.is_admin;
  const willHavePages = fields.pages ?? row.pages;
  if (!willBeAdmin && willHavePages.length === 0) {
    return json(
      { error: 'Grant at least one page, or admin access — or revoke them instead' },
      400
    );
  }

  const { data, error } = await db
    .from('dashboard_users')
    .update(fields)
    .eq('id', id)
    .select('*')
    .single();

  if (error) return json({ error: error.message }, 500);

  invalidateAccessCache();
  return json({ user: data as DashboardUserRow });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await gateMutation(cookies, request);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'Missing id' }, 400);

  const rows = (await listDashboardUsers(true)) ?? [];
  const row = rows.find((r) => r.id === id);
  if (!row) return json({ error: 'No such user' }, 404);

  if (row.email === gate.email) return json({ error: 'You cannot revoke your own access' }, 400);
  if (isLastAdmin(rows, row)) return json({ error: 'Cannot revoke the last admin' }, 400);

  const { error } = await db.from('dashboard_users').delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);

  invalidateAccessCache();
  return json({ ok: true });
};
