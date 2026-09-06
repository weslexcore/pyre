// Dated observations on a guest profile — the flexible half of what we know.
//   POST   { profileId, body }  — add a note, authored by the session
//   PATCH  { id, body }         — fix your own note (admins: anyone's)
//   DELETE ?id=                 — remove your own note (admins: anyone's)
//
// Anyone granted /admin/guests may write: noticing that someone loved the
// birch tonight is exactly the kind of thing the person on shift should be
// able to jot down. Editing and deleting are the author's, because a note
// reads with their name on it.

import type { APIRoute } from 'astro';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import type { GuestProfileNoteRow } from '@/lib/db';
import { getDb } from '@/lib/db';
import { loadProfileById } from '@/lib/guests/store';
import { GUESTS_PAGE } from '@/lib/guests/types';
import { normalizeNoteBody } from '@/lib/guests/validate';
import { sameActor } from '@/lib/sops/names';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const emailOf = (gate: { user: { email: string } }): string =>
  (gate.user.email ?? '').trim().toLowerCase();

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

async function loadNote(
  db: NonNullable<ReturnType<typeof getDb>>,
  id: string
): Promise<GuestProfileNoteRow | null> {
  const { data } = await db.from('guest_profile_notes').select('*').eq('id', id).maybeSingle();
  return (data as GuestProfileNoteRow | null) ?? null;
}

/** Bump the profile so it climbs the "recently updated" list. */
async function touchProfile(
  db: NonNullable<ReturnType<typeof getDb>>,
  profileId: string,
  email: string
): Promise<void> {
  await db
    .from('guest_profiles')
    .update({ updated_by: email, updated_at: new Date().toISOString() })
    .eq('id', profileId);
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

  const profileId = typeof body.profileId === 'string' ? body.profileId : '';
  if (!UUID_RE.test(profileId)) return json({ error: 'profileId must be a UUID' }, 400);

  const note = normalizeNoteBody(body.body);
  if (!note.ok) return json({ error: note.error }, 400);

  const profile = await loadProfileById(db, profileId);
  if (!profile) return json({ error: 'Profile not found' }, 404);

  const email = emailOf(gate);
  const { data, error } = await db
    .from('guest_profile_notes')
    .insert({ profile_id: profileId, body: note.value, author_email: email })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  await touchProfile(db, profileId, email);

  return json({ note: data as GuestProfileNoteRow }, 201);
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

  const note = normalizeNoteBody(body.body);
  if (!note.ok) return json({ error: note.error }, 400);

  const existing = await loadNote(db, id);
  if (!existing) return json({ error: 'Note not found' }, 404);

  const email = emailOf(gate);
  if (!gate.access.isAdmin && !sameActor(existing.author_email, email)) {
    return json({ error: 'Only the person who wrote a note can change it' }, 403);
  }

  const { data, error } = await db
    .from('guest_profile_notes')
    .update({ body: note.value, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ note: data as GuestProfileNoteRow });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await requirePage(cookies, GUESTS_PAGE);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id') ?? '';
  if (!UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);

  const existing = await loadNote(db, id);
  if (!existing) return json({ ok: true });

  const email = emailOf(gate);
  if (!gate.access.isAdmin && !sameActor(existing.author_email, email)) {
    return json({ error: 'Only the person who wrote a note can remove it' }, 403);
  }

  const { error } = await db.from('guest_profile_notes').delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
};
