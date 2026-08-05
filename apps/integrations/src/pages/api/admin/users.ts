// People management for /admin/users: list, add, edit, and remove `staff`
// rows — one row per person, covering both dashboard access (is_admin, pages)
// and the scheduling roster (display_name, is_founder, active). Admin-only on
// every method, CSRF-guarded on mutations.
//
// Guards: an admin can't demote, unlink, or delete themselves; the last admin
// row can't be demoted or deleted; and access can't be granted to a row with
// no email (nobody could log in as them). Rows referenced by assignments or
// time off are deactivated instead of deleted, so schedule history survives.

import type { APIRoute } from 'astro';
import { ADMIN_TOOLS, SCHEDULE_MANAGE } from '@/components/admin/adminTools';
import { getEnvAllowlist, invalidateAccessCache, listStaff } from '@/lib/auth/access';
import { assertSameOrigin, requireAdmin } from '@/lib/auth/admin';
import { getDb, type StaffRow } from '@/lib/db';
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
function isLastAdmin(rows: StaffRow[], row: StaffRow): boolean {
  return row.is_admin && rows.filter((r) => r.is_admin).length === 1;
}

/**
 * Best-effort Momence lookup: people sign in with their Momence account, so
 * the email has to match their Momence login. A miss doesn't block the write
 * — staff logins aren't always host members — but the UI surfaces it.
 */
async function lookupMember(
  email: string
): Promise<{ matched: boolean; displayName: string | null; memberId: number | null }> {
  try {
    const member = await findMemberByEmail(email);
    if (member) {
      return {
        matched: true,
        displayName: `${member.firstName ?? ''} ${member.lastName ?? ''}`.trim() || null,
        memberId: member.id,
      };
    }
  } catch (e) {
    console.warn('[users] Momence lookup failed:', e instanceof Error ? e.message : e);
  }
  return { matched: false, displayName: null, memberId: null };
}

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const staff = await listStaff(true);
  if (staff === null) return json({ error: 'Storage unavailable' }, 503);

  // Env-allowlisted emails without a staff row, so the legacy ADMIN_EMAILS /
  // STAFF_EMAILS entries stay visible and importable. Whether they actually
  // grant access depends on the bootstrap rule (only while the table has no
  // admin row) — envActive tells the UI which wording to use.
  const envUsers = getEnvAllowlist().filter((e) => !staff.some((s) => s.email === e.email));

  return json({
    staff,
    envUsers,
    envActive: !staff.some((s) => s.is_admin),
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

  const rawEmail = String(body.email ?? '')
    .trim()
    .toLowerCase();
  if (rawEmail && !EMAIL_RE.test(rawEmail)) return json({ error: 'Invalid email' }, 400);
  const email = rawEmail || null;

  const isAdmin = body.isAdmin === true;
  const pages = parsePages(body.pages);
  if (pages instanceof Response) return pages;
  if (!email && (isAdmin || pages.length > 0)) {
    return json({ error: 'Dashboard access needs a Momence login email' }, 400);
  }

  let displayName = String(body.displayName ?? '').trim();
  if (displayName.length > 60) return json({ error: 'Name must be 60 characters or fewer' }, 400);

  const member = email
    ? await lookupMember(email)
    : { matched: false, displayName: null, memberId: null };

  // Fall back to the Momence member name, then the email's local part, so
  // every row has something to show on the schedule board.
  if (!displayName) displayName = member.displayName ?? (email ? email.split('@')[0] : '');
  if (!displayName) return json({ error: 'Name or email is required' }, 400);

  const { data, error } = await db
    .from('staff')
    .insert({
      display_name: displayName,
      email,
      is_admin: isAdmin,
      pages,
      is_founder: body.isFounder === true,
      // Default off: someone added for dashboard access alone shouldn't
      // silently show up as assignable on the schedule board.
      active: body.active === true,
      momence_member_id: member.memberId,
      added_by: gate.email,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') return json({ error: `${email} is already on this list` }, 409);
    return json({ error: error.message }, 500);
  }

  invalidateAccessCache();
  return json({ person: data as StaffRow, momenceMatch: member.matched }, 201);
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

  const rows = (await listStaff(true)) ?? [];
  const row = rows.find((r) => r.id === id);
  if (!row) return json({ error: 'No such person' }, 404);

  const isSelf = !!row.email && row.email === gate.email;
  const fields: Partial<
    Pick<
      StaffRow,
      | 'is_admin'
      | 'pages'
      | 'display_name'
      | 'email'
      | 'is_founder'
      | 'active'
      | 'momence_member_id'
    >
  > = {};
  let momenceMatch: boolean | undefined;

  if (body.isAdmin !== undefined) {
    const isAdmin = body.isAdmin === true;
    if (!isAdmin && isSelf) {
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

  if (body.displayName !== undefined) {
    const displayName = String(body.displayName ?? '').trim();
    if (!displayName || displayName.length > 60) {
      return json({ error: 'Name must be 1-60 characters' }, 400);
    }
    fields.display_name = displayName;
  }

  if (body.email !== undefined) {
    const email = body.email === null ? null : String(body.email).trim().toLowerCase() || null;
    if (email && !EMAIL_RE.test(email)) return json({ error: 'Invalid email' }, 400);
    if (email !== row.email) {
      if (isSelf) return json({ error: 'You cannot change your own login email' }, 400);
      fields.email = email;
      if (email) {
        const member = await lookupMember(email);
        momenceMatch = member.matched;
        fields.momence_member_id = member.memberId;
      } else {
        fields.momence_member_id = null;
      }
    }
  }

  if (body.isFounder !== undefined) fields.is_founder = body.isFounder === true;
  if (body.active !== undefined) fields.active = body.active === true;

  if (Object.keys(fields).length === 0) return json({ error: 'Nothing to update' }, 400);

  // An access grant with no email is unreachable — nobody can log in as them.
  const willBeAdmin = fields.is_admin ?? row.is_admin;
  const willHavePages = fields.pages ?? row.pages;
  const willHaveEmail = fields.email !== undefined ? fields.email : row.email;
  if (!willHaveEmail && (willBeAdmin || willHavePages.length > 0)) {
    return json({ error: 'Dashboard access needs a Momence login email' }, 400);
  }

  const { data, error } = await db.from('staff').update(fields).eq('id', id).select('*').single();

  if (error) {
    if (error.code === '23505') return json({ error: 'That email is already in use' }, 409);
    return json({ error: error.message }, 500);
  }

  invalidateAccessCache();
  return json({ person: data as StaffRow, momenceMatch });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await gateMutation(cookies, request);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'Missing id' }, 400);

  const rows = (await listStaff(true)) ?? [];
  const row = rows.find((r) => r.id === id);
  if (!row) return json({ error: 'No such person' }, 404);

  if (row.email && row.email === gate.email) {
    return json({ error: 'You cannot remove your own access' }, 400);
  }
  if (isLastAdmin(rows, row)) return json({ error: 'Cannot remove the last admin' }, 400);

  const { error } = await db.from('staff').delete().eq('id', id);

  // 23503 = still referenced by shift_assignments or time_off. Their schedule
  // history has to stay, so strip access and take them off the roster instead
  // of deleting the person.
  if (error?.code === '23503') {
    const { error: deactivateError } = await db
      .from('staff')
      .update({ active: false, is_admin: false, pages: [] })
      .eq('id', id);
    if (deactivateError) return json({ error: deactivateError.message }, 500);
    invalidateAccessCache();
    return json({ ok: true, deactivated: true });
  }
  if (error) return json({ error: error.message }, 500);

  invalidateAccessCache();
  return json({ ok: true, deactivated: false });
};
