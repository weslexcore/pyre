// Admin messages: what an admin writes to the team and the threads that
// grow under them (/admin/messages). Reading is open to any dashboard user
// and filtered by the message's audience (lib/messages/access); writing,
// editing, pinning, archiving, and deleting a message is admin-only. Author
// identity always comes from the session. Replies have their own route
// (message-replies.ts).
//
//   GET  [?archived=1]         → { messages, people, viewer, staff? }
//   GET  ?id=<uuid>            → { message, replies, people, viewer }
//   POST { title, bodyMd, audienceRoles, audienceEmails, pinned?, email?,
//          draft?, sharedWith? }
//                              → { message, people, notified, emailed }
//   PATCH { id, title?, bodyMd?, audienceRoles?, audienceEmails?, pinned?, archived?,
//           sharedWith?, send?, email?, expectedUpdatedAt? }
//                              → { message, people, notified, emailed }
//   DELETE ?id=<uuid>          → { ok: true }
//
// Posting notifies the whole audience, and unless `email: false` also emails
// them the message with a link to its thread; an edit that widens it notifies the
// people it adds (lib/notifications/messages).
//
// `draft: true` saves the message without sending it: nobody in the audience
// sees it or hears about it. `sharedWith` names the admins who may open and
// edit the draft alongside its author (empty = private), and adding someone
// notifies them. PATCH `send: true` sends a draft — the same notifications and
// (unless `email: false`) emails as posting it. Only the draft's author and
// collaborators may change, send, or delete it (lib/messages/access).
// `expectedUpdatedAt` is the updated_at the editor started from: if someone
// else saved since, the PATCH is refused with 409 rather than overwriting.
//
// Opening one message marks the viewer's notifications about it read.
// `staff` (the roster the audience picker offers) rides only on the admin
// list response — it is the address book, never handed to non-admins. A
// message the caller can't see reads as missing, never as forbidden.

import type { APIRoute } from 'astro';
import { type AdminGate, assertSameOrigin, requireAdmin, requireStaff } from '@/lib/auth/admin';
import { type AdminMessageRow, getDb } from '@/lib/db';
import { normalizeEmail } from '@/lib/email/address';
import { dbError, isUuid, json, readJsonBody } from '@/lib/http/route';
import {
  addedCollaborators,
  canChangeMessage,
  canViewMessage,
  isDraft,
} from '@/lib/messages/access';
import { listMessagesForViewer, loadMessageForViewer } from '@/lib/messages/store';
import {
  BODY_MAX,
  normalizeBody,
  normalizeTitle,
  parseAudience,
  parseSharedWith,
} from '@/lib/messages/validate';
import {
  emailMessagePosted,
  notifyDraftShared,
  notifyMessageAudienceWidened,
  notifyMessagePosted,
} from '@/lib/notifications/messages';
import { deleteBySource, markSourceRead } from '@/lib/notifications/notify';
import type { SopViewer } from '@/lib/sops/levels';
import { getPeopleNames, listGrantablePeople } from '@/lib/sops/people';
import { getSopRole } from '@/lib/sops/role';

async function viewerOf(gate: AdminGate): Promise<SopViewer> {
  return {
    role: await getSopRole(gate.user.email ?? null, gate.access),
    email: normalizeEmail(gate.user.email),
  };
}

/** The audience emails a request names, checked against the roster. */
async function checkedAudience(
  roles: unknown,
  emails: unknown
): Promise<{ roles: AdminMessageRow['audience_roles']; emails: string[] } | { error: string }> {
  const parsed = parseAudience(roles, emails);
  if (!parsed.ok) return { error: parsed.error };
  const roster = new Set((await listGrantablePeople()).map((person) => person.email));
  const unknown = parsed.audience.emails.filter((email) => !roster.has(email));
  if (unknown.length > 0) {
    return { error: `audienceEmails names people not on the roster: ${unknown.join(', ')}` };
  }
  return parsed.audience;
}

/** The admins a draft is shared with, checked against the roster. */
async function checkedSharedWith(
  value: unknown,
  author: string
): Promise<{ emails: string[] } | { error: string }> {
  const parsed = parseSharedWith(value, author);
  if (!parsed.ok) return { error: parsed.error };
  const admins = new Set(
    (await listGrantablePeople())
      .filter((person) => person.role === 'admin')
      .map((person) => person.email)
  );
  const notAdmins = parsed.emails.filter((email) => !admins.has(email));
  if (notAdmins.length > 0) {
    return { error: `Drafts can only be shared with admins: ${notAdmins.join(', ')}` };
  }
  return { emails: parsed.emails };
}

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  return readJsonBody(request);
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requireStaff(cookies);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const viewer = await viewerOf(gate);
  const id = url.searchParams.get('id');
  if (id) {
    if (!isUuid(id)) return json({ error: 'id must be a UUID' }, 400);
    const result = await loadMessageForViewer(db, viewer, id);
    if (!result.ok) return json({ error: result.error }, result.status);
    if (viewer.email) await markSourceRead(db, viewer.email, 'admin_message', id);
    return json({ ...result.thread, viewer });
  }

  const isAdmin = viewer.role === 'admin';
  const includeArchived = isAdmin && url.searchParams.get('archived') === '1';
  const { messages, people, error } = await listMessagesForViewer(db, viewer, { includeArchived });
  if (error) return json({ error }, 500);
  return json({
    messages,
    people,
    viewer,
    staff: isAdmin ? await listGrantablePeople() : undefined,
  });
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
  if (body.email !== undefined && typeof body.email !== 'boolean') {
    return json({ error: 'email must be a boolean' }, 400);
  }
  if (body.draft !== undefined && typeof body.draft !== 'boolean') {
    return json({ error: 'draft must be a boolean' }, 400);
  }
  const draft = body.draft === true;
  let sharedWith: string[] = [];
  if (body.sharedWith !== undefined) {
    if (!draft) return json({ error: 'Only a draft can be shared' }, 400);
    const shared = await checkedSharedWith(body.sharedWith, email);
    if ('error' in shared) return json({ error: shared.error }, 400);
    sharedWith = shared.emails;
  }

  const { data, error } = await db
    .from('admin_messages')
    .insert({
      title,
      body_md: bodyMd,
      author_email: email,
      audience_roles: audience.roles,
      audience_emails: audience.emails,
      pinned: body.pinned === true,
      // Left out for a send, so the column's now() default stamps it.
      ...(draft ? { sent_at: null, shared_with: sharedWith } : {}),
    })
    .select('*')
    .single();
  if (error) return dbError(error);
  const message = data as AdminMessageRow;

  if (draft) {
    const notified = await notifyDraftShared(db, message, sharedWith, email);
    return json({ message, people: await getPeopleNames([email]), notified, emailed: 0 }, 201);
  }
  const notified = await notifyMessagePosted(db, message);
  const emailed =
    body.email === false ? 0 : await emailMessagePosted(message, new URL(request.url).origin);
  return json({ message, people: await getPeopleNames([email]), notified, emailed }, 201);
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
  const viewer = await viewerOf(gate);

  const id = typeof body.id === 'string' ? body.id : '';
  if (!isUuid(id)) return json({ error: 'id must be a UUID' }, 400);

  const { data: found, error: readError } = await db
    .from('admin_messages')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (readError) return dbError(readError);
  const existing = (found as AdminMessageRow | null) ?? null;
  if (!existing || !canViewMessage(viewer, existing)) {
    return json({ error: 'Message not found' }, 404);
  }
  if (!canChangeMessage(viewer, existing)) {
    return json(
      { error: 'Only its author and the admins it is shared with can change a draft' },
      403
    );
  }
  const wasDraft = isDraft(existing);

  const expected = body.expectedUpdatedAt;
  if (expected !== undefined && typeof expected !== 'string') {
    return json({ error: 'expectedUpdatedAt must be a timestamp' }, 400);
  }
  if (expected !== undefined && Date.parse(expected) !== Date.parse(existing.updated_at)) {
    return json(
      {
        error: 'Someone else saved this message since you opened it. Reload to see their changes.',
      },
      409
    );
  }

  const patch: Partial<AdminMessageRow> = {};
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
  if (body.archived !== undefined) {
    if (typeof body.archived !== 'boolean')
      return json({ error: 'archived must be a boolean' }, 400);
    if (wasDraft) return json({ error: 'A draft can be deleted, not archived' }, 400);
    patch.archived_at = body.archived ? new Date().toISOString() : null;
  }
  if (body.sharedWith !== undefined) {
    if (!wasDraft) return json({ error: 'Only a draft can be shared' }, 400);
    const shared = await checkedSharedWith(body.sharedWith, existing.author_email);
    if ('error' in shared) return json({ error: shared.error }, 400);
    patch.shared_with = shared.emails;
  }
  if (body.email !== undefined && typeof body.email !== 'boolean') {
    return json({ error: 'email must be a boolean' }, 400);
  }
  if (body.send !== undefined) {
    if (typeof body.send !== 'boolean') return json({ error: 'send must be a boolean' }, 400);
    if (body.send && !wasDraft) return json({ error: 'This message was already sent' }, 409);
    if (body.send) patch.sent_at = new Date().toISOString();
  }
  if (Object.keys(patch).length === 0) return json({ error: 'Nothing to update' }, 400);
  patch.updated_by = email;

  // Matching updated_at too closes the gap between the read above and this
  // write: a save that lands in between makes this one miss, not overwrite.
  const { data, error } = await db
    .from('admin_messages')
    .update(patch)
    .eq('id', id)
    .eq('updated_at', existing.updated_at)
    .select('*')
    .maybeSingle();
  if (error) return dbError(error);
  if (!data) {
    return json(
      { error: 'Someone else saved this message at the same time. Reload to see their changes.' },
      409
    );
  }
  const message = data as AdminMessageRow;
  const people = await getPeopleNames([message.author_email, email]);

  if (wasDraft && !isDraft(message)) {
    const notified = await notifyMessagePosted(db, message, email);
    const emailed =
      body.email === false
        ? 0
        : await emailMessagePosted(message, new URL(request.url).origin, email);
    return json({ message, people, notified, emailed });
  }
  if (wasDraft) {
    const added = addedCollaborators(existing.shared_with, message.shared_with, email);
    const notified = await notifyDraftShared(db, message, added, email);
    return json({ message, people, notified, emailed: 0 });
  }
  const notified = patch.audience_roles
    ? await notifyMessageAudienceWidened(db, message, existing, email)
    : 0;
  return json({ message, people, notified, emailed: 0 });
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

  const viewer = await viewerOf(gate);
  const { data: found, error: readError } = await db
    .from('admin_messages')
    .select('author_email, audience_roles, audience_emails, archived_at, sent_at, shared_with')
    .eq('id', id)
    .maybeSingle();
  if (readError) return dbError(readError);
  if (!found || !canViewMessage(viewer, found)) return json({ error: 'Message not found' }, 404);
  if (!canChangeMessage(viewer, found)) {
    return json(
      { error: 'Only its author and the admins it is shared with can delete a draft' },
      403
    );
  }

  const { error, count } = await db.from('admin_messages').delete({ count: 'exact' }).eq('id', id);
  if (error) return dbError(error);
  if (!count) return json({ error: 'Message not found' }, 404);
  await deleteBySource(db, 'admin_message', id);

  return json({ ok: true });
};
