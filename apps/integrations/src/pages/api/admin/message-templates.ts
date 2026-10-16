// Message templates: reusable starting points for admin messages, managed on
// /admin/messages/templates and offered by the message composer. Admin-only
// throughout — templates are shared, so any admin may change any of them.
// Using a template copies it into the composer (placeholders filled by
// lib/messages/templates); nothing here sends or touches a message.
//
//   GET                         → { templates, people }
//   POST  { name, title, bodyMd, audienceRoles, audienceEmails, pinned? }
//                               → { template }
//   PATCH { id, name?, title?, bodyMd?, audienceRoles?, audienceEmails?, pinned?,
//           expectedUpdatedAt? }
//                               → { template }
//   DELETE ?id=<uuid>           → { ok: true }
//
// Names are unique ignoring case; a clash is a 409. The editor autosaves, so
// a PATCH may carry `expectedUpdatedAt` — the version it started from — and
// is refused with 409 if another admin saved since, rather than overwriting.

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin } from '@/lib/auth/admin';
import { type AdminMessageTemplateRow, getDb } from '@/lib/db';
import { normalizeEmail } from '@/lib/email/address';
import { isUniqueViolation, isUuid, json, readJsonBody } from '@/lib/http/route';
import { checkedAudience } from '@/lib/messages/roster';
import { normalizeTemplateName, TEMPLATE_NAME_MAX } from '@/lib/messages/templates';
import { BODY_MAX, normalizeBody, normalizeTitle } from '@/lib/messages/validate';
import { getPeopleNames } from '@/lib/sops/people';

function saveError(error: { message: string }): Response {
  if (isUniqueViolation(error)) {
    return json({ error: 'A template with that name already exists' }, 409);
  }
  return json({ error: error.message }, 500);
}

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  return readJsonBody(request);
}

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const { data, error } = await db
    .from('admin_message_templates')
    .select('*')
    .order('name', { ascending: true });
  if (error) return json({ error: error.message }, 500);
  const templates = (data ?? []) as AdminMessageTemplateRow[];
  const people = await getPeopleNames(templates.flatMap((t) => [t.created_by, t.updated_by ?? '']));
  return json({ templates, people });
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;
  const body = await readJson(request);
  if (body instanceof Response) return body;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const email = normalizeEmail(gate.user.email);
  if (!email) return json({ error: 'Session has no email' }, 400);

  const name = normalizeTemplateName(body.name);
  if (!name) return json({ error: `name is required (max ${TEMPLATE_NAME_MAX} chars)` }, 400);
  const title = normalizeTitle(body.title);
  if (!title) return json({ error: 'title is required (max 200 chars)' }, 400);
  const bodyMd = normalizeBody(body.bodyMd, BODY_MAX);
  if (!bodyMd) return json({ error: `bodyMd is required (max ${BODY_MAX} chars)` }, 400);
  const audience = await checkedAudience(
    body.audienceRoles ?? ['staff', 'shift_lead', 'admin'],
    body.audienceEmails ?? []
  );
  if ('error' in audience) return json({ error: audience.error }, 400);
  if (body.pinned !== undefined && typeof body.pinned !== 'boolean') {
    return json({ error: 'pinned must be a boolean' }, 400);
  }

  const { data, error } = await db
    .from('admin_message_templates')
    .insert({
      name,
      title,
      body_md: bodyMd,
      audience_roles: audience.roles,
      audience_emails: audience.emails,
      pinned: body.pinned === true,
      created_by: email,
    })
    .select('*')
    .single();
  if (error) return saveError(error);
  return json({ template: data as AdminMessageTemplateRow }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;
  const body = await readJson(request);
  if (body instanceof Response) return body;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const email = normalizeEmail(gate.user.email);
  if (!email) return json({ error: 'Session has no email' }, 400);

  const id = typeof body.id === 'string' ? body.id : '';
  if (!isUuid(id)) return json({ error: 'id must be a UUID' }, 400);

  const expected = body.expectedUpdatedAt;
  if (expected !== undefined && typeof expected !== 'string') {
    return json({ error: 'expectedUpdatedAt must be a timestamp' }, 400);
  }

  const patch: Partial<AdminMessageTemplateRow> = {};
  if (body.name !== undefined) {
    const name = normalizeTemplateName(body.name);
    if (!name) {
      return json({ error: `name must be non-empty (max ${TEMPLATE_NAME_MAX} chars)` }, 400);
    }
    patch.name = name;
  }
  if (body.title !== undefined) {
    const title = normalizeTitle(body.title);
    if (!title) return json({ error: 'title must be non-empty (max 200 chars)' }, 400);
    patch.title = title;
  }
  if (body.bodyMd !== undefined) {
    const bodyMd = normalizeBody(body.bodyMd, BODY_MAX);
    if (!bodyMd) return json({ error: `bodyMd must be non-empty (max ${BODY_MAX} chars)` }, 400);
    patch.body_md = bodyMd;
  }
  if (body.audienceRoles !== undefined || body.audienceEmails !== undefined) {
    const { data: existing } = await db
      .from('admin_message_templates')
      .select('audience_roles, audience_emails')
      .eq('id', id)
      .maybeSingle();
    if (!existing) return json({ error: 'Template not found' }, 404);
    const audience = await checkedAudience(
      body.audienceRoles ?? existing.audience_roles,
      body.audienceEmails ?? existing.audience_emails
    );
    if ('error' in audience) return json({ error: audience.error }, 400);
    patch.audience_roles = audience.roles;
    patch.audience_emails = audience.emails;
  }
  if (body.pinned !== undefined) {
    if (typeof body.pinned !== 'boolean') return json({ error: 'pinned must be a boolean' }, 400);
    patch.pinned = body.pinned;
  }
  if (Object.keys(patch).length === 0) return json({ error: 'Nothing to update' }, 400);
  patch.updated_by = email;

  let update = db.from('admin_message_templates').update(patch).eq('id', id);
  if (expected !== undefined) update = update.eq('updated_at', expected);
  const { data, error } = await update.select('*').maybeSingle();
  if (error) return saveError(error);
  if (!data) {
    if (expected === undefined) return json({ error: 'Template not found' }, 404);
    const { data: still } = await db
      .from('admin_message_templates')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (!still) return json({ error: 'Template not found' }, 404);
    return json(
      { error: 'Someone else saved this template since you opened it.', conflict: true },
      409
    );
  }
  return json({ template: data as AdminMessageTemplateRow });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id') ?? '';
  if (!isUuid(id)) return json({ error: 'id must be a UUID' }, 400);

  const { error, count } = await db
    .from('admin_message_templates')
    .delete({ count: 'exact' })
    .eq('id', id);
  if (error) return json({ error: error.message }, 500);
  if (!count) return json({ error: 'Template not found' }, 404);
  return json({ ok: true });
};
