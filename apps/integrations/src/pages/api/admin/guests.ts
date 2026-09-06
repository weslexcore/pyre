// Guest profiles API. GET searches (our profiles and Momence together), lists
// recent profiles, or returns one profile with its fields and notes; POST
// starts a profile for a Momence member; PATCH saves the summary and answers;
// DELETE removes one outright (admin only, for test rows).
//
// Permissions: anyone granted /admin/guests may do all of the reading and
// writing here — knowing and recording what a guest likes is the job of
// whoever is at the door. The field *definitions* are the managed half and
// live in /api/admin/guest-fields. Identity (created_by, updated_by) always
// comes from the session, never from a request body.
//
// The Momence account (visits, purchases, history) is a separate, slower
// call: /api/admin/guest-momence. This route answers from our own tables so
// the profile page paints immediately.

import type { APIRoute } from 'astro';
import { hasGuestsManage } from '@/components/admin/adminTools';
import { assertSameOrigin, requireAdmin, requirePage } from '@/lib/auth/admin';
import type { GuestProfileRow } from '@/lib/db';
import { getDb } from '@/lib/db';
import { loadFields, loadNotes, loadProfileById, loadProfileByMemberId } from '@/lib/guests/store';
import { GUESTS_PAGE } from '@/lib/guests/types';
import { mergeAnswers, normalizeMemberId, normalizeSummary } from '@/lib/guests/validate';
import { fetchHostMember, fetchMembersFiltered } from '@/lib/momence/host-api';
import { getPeopleNames } from '@/lib/sops/people';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECENT_LIMIT = 40;
const LOCAL_SEARCH_LIMIT = 20;
const MOMENCE_SEARCH_LIMIT = 8;
const MIN_QUERY_LENGTH = 2;

const emailOf = (gate: { user: { email: string } }): string =>
  (gate.user.email ?? '').trim().toLowerCase();

/** One row in the search results — a Momence member, with or without a profile. */
export interface GuestSearchHit {
  memberId: string;
  name: string;
  email: string;
  phone: string;
  hasProfile: boolean;
  summary: string | null;
  updatedAt: string | null;
}

function hitFromProfile(profile: GuestProfileRow): GuestSearchHit {
  return {
    memberId: profile.momence_member_id,
    name: profile.name ?? profile.email ?? `Member ${profile.momence_member_id}`,
    email: profile.email ?? '',
    phone: '',
    hasProfile: true,
    summary: profile.summary,
    updatedAt: profile.updated_at,
  };
}

/** `%` and `_` are wildcards to ILIKE; a name never needs them. */
function likePattern(query: string): string {
  return `%${query.replace(/[%_\\]/g, '')}%`;
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, GUESTS_PAGE);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const canManage = hasGuestsManage(gate.access);
  const self = emailOf(gate);

  // One guest: the profile (if any), the question list, and the notes.
  const memberIdParam = url.searchParams.get('memberId');
  if (memberIdParam !== null) {
    const memberId = normalizeMemberId(memberIdParam);
    if (!memberId) return json({ error: 'memberId must be a Momence member id' }, 400);

    const [profile, fields] = await Promise.all([
      loadProfileByMemberId(db, memberId),
      loadFields(db),
    ]);
    const notes = profile ? await loadNotes(db, profile.id) : [];
    const people = await getPeopleNames([
      profile?.created_by ?? '',
      profile?.updated_by ?? '',
      ...notes.map((n) => n.author_email),
    ]);

    return json({
      memberId,
      profile,
      fields,
      notes,
      people,
      canManage,
      isAdmin: gate.access.isAdmin,
      self,
    });
  }

  // Search: our profiles by cached name/email, and Momence by its own fuzzy
  // search, merged by member id so a guest with a profile shows it.
  const query = (url.searchParams.get('q') ?? '').trim();
  if (query) {
    if (query.length < MIN_QUERY_LENGTH) {
      return json({ query, results: [], momenceAvailable: true, canManage, self });
    }

    const pattern = likePattern(query);
    const [{ data: byName }, { data: byEmail }] = await Promise.all([
      db.from('guest_profiles').select('*').ilike('name', pattern).limit(LOCAL_SEARCH_LIMIT),
      db.from('guest_profiles').select('*').ilike('email', pattern).limit(LOCAL_SEARCH_LIMIT),
    ]);
    const local = new Map<string, GuestProfileRow>();
    for (const row of [...(byName ?? []), ...(byEmail ?? [])] as GuestProfileRow[]) {
      local.set(row.momence_member_id, row);
    }

    const results: GuestSearchHit[] = [];
    let momenceAvailable = true;
    try {
      const { members } = await fetchMembersFiltered({
        page: 0,
        pageSize: MOMENCE_SEARCH_LIMIT,
        query,
        sortBy: 'lastSeenAt',
        sortOrder: 'DESC',
      });
      for (const m of members) {
        const memberId = String(m.id);
        const profile = local.get(memberId) ?? null;
        results.push({
          memberId,
          name: [m.firstName, m.lastName].filter(Boolean).join(' ').trim() || m.email,
          email: (m.email ?? '').trim().toLowerCase(),
          phone: m.phoneNumber ?? '',
          hasProfile: profile !== null,
          summary: profile?.summary ?? null,
          updatedAt: profile?.updated_at ?? null,
        });
        local.delete(memberId);
      }
    } catch (e) {
      // Momence down: the profiles we already hold still answer the search.
      console.error('[guests] Momence search failed:', e instanceof Error ? e.message : e);
      momenceAvailable = false;
    }

    // Profiles Momence's search didn't surface (or couldn't, while down).
    for (const profile of local.values()) results.push(hitFromProfile(profile));

    return json({ query, results, momenceAvailable, canManage, self });
  }

  // The landing list: whoever was written about most recently.
  const { data, error } = await db
    .from('guest_profiles')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(RECENT_LIMIT);
  if (error) return json({ error: error.message }, 500);

  const { count } = await db.from('guest_profiles').select('id', { count: 'exact', head: true });

  return json({
    recent: (data ?? []) as GuestProfileRow[],
    total: count ?? 0,
    canManage,
    self,
  });
};

async function readJsonBody(request: Request): Promise<Record<string, unknown> | Response> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
}

/** Trimmed display name / email from a body, for when Momence can't be asked. */
function fallbackIdentity(body: Record<string, unknown>): {
  name: string | null;
  email: string | null;
} {
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 320) : '';
  return { name: name || null, email: email || null };
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, GUESTS_PAGE);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const memberId = normalizeMemberId(body.memberId);
  if (!memberId) return json({ error: 'memberId must be a Momence member id' }, 400);

  // Idempotent: two people opening the same new guest at once both get the
  // one profile.
  const existing = await loadProfileByMemberId(db, memberId);
  if (existing) return json({ profile: existing, created: false });

  // Cache the name and email from Momence so the list can be searched
  // without it. When Momence is unreachable, the island's copy stands in.
  let identity = fallbackIdentity(body);
  try {
    const member = await fetchHostMember(Number(memberId));
    identity = {
      name: [member.firstName, member.lastName].filter(Boolean).join(' ').trim() || identity.name,
      email: (member.email ?? '').trim().toLowerCase() || identity.email,
    };
  } catch (e) {
    console.error(`[guests] member ${memberId} lookup failed:`, e instanceof Error ? e.message : e);
  }

  const summary = normalizeSummary(body.summary);
  if (!summary.ok) return json({ error: summary.error }, 400);
  const fields = await loadFields(db);
  const values = mergeAnswers(fields, {}, body.values);

  const email = emailOf(gate);
  const { data, error } = await db
    .from('guest_profiles')
    .insert({
      momence_member_id: memberId,
      name: identity.name,
      email: identity.email,
      summary: summary.value,
      field_values: values,
      created_by: email,
      updated_by: email,
    })
    .select('*')
    .single();
  if (error) {
    // Lost the race to another tab: hand back theirs.
    if (error.code === '23505') {
      const theirs = await loadProfileByMemberId(db, memberId);
      if (theirs) return json({ profile: theirs, created: false });
    }
    return json({ error: error.message }, 500);
  }

  return json({ profile: data as GuestProfileRow, created: true }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, GUESTS_PAGE);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const id = typeof body.id === 'string' ? body.id : '';
  if (!UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);

  const profile = await loadProfileById(db, id);
  if (!profile) return json({ error: 'Profile not found' }, 404);

  const patch: Record<string, unknown> = {};

  if ('summary' in body) {
    const summary = normalizeSummary(body.summary);
    if (!summary.ok) return json({ error: summary.error }, 400);
    patch.summary = summary.value;
  }

  if ('values' in body) {
    const fields = await loadFields(db);
    patch.field_values = mergeAnswers(fields, profile.field_values, body.values);
  }

  if (Object.keys(patch).length === 0) return json({ error: 'Nothing to change' }, 400);

  const { data, error } = await db
    .from('guest_profiles')
    .update({ ...patch, updated_by: emailOf(gate), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ profile: data as GuestProfileRow });
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

  // Notes cascade in the database.
  const { error } = await db.from('guest_profiles').delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
};
