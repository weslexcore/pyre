// Lost & Found API. GET reads the log (or one item with its photos, notices,
// and audit trail), POST logs a found item, PATCH edits it or moves its
// status, DELETE removes one outright (admin only, for test rows).
//
// Permissions:
//   * Anyone granted /admin/lost-found may log an item, read the whole log,
//     and hand something back — marking it picked up, or discarding a used
//     water bottle. That is deliberately the floor: whoever is on shift is who
//     a guest asks at the desk, and a log only half of staff can read is a bin
//     with extra steps.
//   * lost-found:manage (or admin) additionally emails guests (the notify
//     route) and records donations. Both reach outside the building.
//
// Identity always comes from the session: logged_by, picked_up_by, donated_by
// and every audit actor are the authenticated email, never a value from the
// request body. claimed_by_* is not settable here at all — a claim arrives
// through the signed link, which is the only thing that can attest to it.

import type { APIRoute } from 'astro';
import { hasLostFoundManage } from '@/components/admin/adminTools';
import { assertSameOrigin, requireAdmin, requirePage } from '@/lib/auth/admin';
import type { LostFoundAttachmentRow, LostFoundItemRow, LostFoundNoticeRow } from '@/lib/db';
import { getDb } from '@/lib/db';
import { loadLostFoundEvents, logLostFoundEvent } from '@/lib/lost-found/log';
import { LOST_FOUND_BUCKET } from '@/lib/lost-found/media';
import {
  CLOSED_STATUSES,
  isLostFoundStatus,
  ON_HAND_STATUSES,
  STAFF_SETTABLE_STATUSES,
} from '@/lib/lost-found/types';
import {
  diffItemFields,
  FIELD_LIMITS,
  normalizeItemPatch,
  normalizeItemSubmission,
} from '@/lib/lost-found/validate';
import { getPeopleNames } from '@/lib/sops/people';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const PAGE = '/admin/lost-found';
const LIST_LIMIT = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = NonNullable<ReturnType<typeof getDb>>;

const emailOf = (gate: { user: { email: string } }): string =>
  (gate.user.email ?? '').trim().toLowerCase();

const displayName = (user: { firstName?: string; lastName?: string; email: string }): string =>
  [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email;

async function loadAttachments(db: Db, itemId: string): Promise<LostFoundAttachmentRow[]> {
  const { data } = await db
    .from('lost_found_attachments')
    .select('*')
    .eq('item_id', itemId)
    .order('created_at', { ascending: true });
  return (data ?? []) as LostFoundAttachmentRow[];
}

async function loadNotices(db: Db, itemId: string): Promise<LostFoundNoticeRow[]> {
  const { data } = await db
    .from('lost_found_notices')
    .select('*')
    .eq('item_id', itemId)
    .order('sent_at', { ascending: false });
  return (data ?? []) as LostFoundNoticeRow[];
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const canManage = hasLostFoundManage(gate.access);
  const email = emailOf(gate);

  // One item, by id or by case number.
  const id = url.searchParams.get('id');
  const reference = url.searchParams.get('reference');
  if (id || reference) {
    if (id && !UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);

    let query = db.from('lost_found_items').select('*');
    query = id ? query.eq('id', id) : query.eq('reference', (reference as string).toUpperCase());
    const { data, error } = await query.maybeSingle();
    if (error) return json({ error: error.message }, 500);

    const item = (data as LostFoundItemRow) ?? null;
    if (!item) return json({ error: 'Item not found' }, 404);

    const [attachments, notices, events] = await Promise.all([
      loadAttachments(db, item.id),
      loadNotices(db, item.id),
      loadLostFoundEvents(db, item.id),
    ]);

    const people = await getPeopleNames([
      item.logged_by,
      item.picked_up_by ?? '',
      item.donated_by ?? '',
      ...events.map((e) => e.actor),
      ...attachments.map((a) => a.uploaded_by),
    ]);

    return json({ item, attachments, notices, events, people, canManage, self: email });
  }

  // The log. Everyone granted the page sees all of it.
  let query = db
    .from('lost_found_items')
    .select('*')
    .order('found_at', { ascending: false })
    .limit(LIST_LIMIT);

  const status = url.searchParams.get('status');
  if (status === 'on_hand') {
    query = query.in('status', ON_HAND_STATUSES);
  } else if (status === 'closed') {
    query = query.in('status', CLOSED_STATUSES);
  } else if (status) {
    if (!isLostFoundStatus(status)) return json({ error: 'Unknown status filter' }, 400);
    query = query.eq('status', status);
  }

  const since = url.searchParams.get('since');
  if (since) {
    if (Number.isNaN(Date.parse(since))) return json({ error: 'since must be a date' }, 400);
    query = query.gte('found_at', new Date(since).toISOString());
  }

  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);

  const items = (data ?? []) as LostFoundItemRow[];

  // Photo counts and notice counts in one round trip each, so the log can show
  // a camera badge and an "asked N people" line without fetching every row.
  // One pass over each child table: the log wants a count badge, an "asked N"
  // line, and the id of each item's first photo for its thumbnail.
  const photoCounts: Record<string, number> = {};
  const noticeCounts: Record<string, number> = {};
  const firstPhoto: Record<string, string> = {};
  if (items.length > 0) {
    const ids = items.map((i) => i.id);
    const [{ data: attachmentRows }, { data: noticeRows }] = await Promise.all([
      db
        .from('lost_found_attachments')
        .select('item_id, id, kind, created_at')
        .in('item_id', ids)
        .order('created_at', { ascending: true }),
      db.from('lost_found_notices').select('item_id').in('item_id', ids),
    ]);
    for (const row of (attachmentRows ?? []) as {
      item_id: string;
      id: string;
      kind: string;
    }[]) {
      photoCounts[row.item_id] = (photoCounts[row.item_id] ?? 0) + 1;
      if (row.kind === 'photo' && !firstPhoto[row.item_id]) firstPhoto[row.item_id] = row.id;
    }
    for (const row of (noticeRows ?? []) as { item_id: string }[]) {
      noticeCounts[row.item_id] = (noticeCounts[row.item_id] ?? 0) + 1;
    }
  }

  const people = await getPeopleNames(
    items.flatMap((i) => [i.logged_by, i.picked_up_by ?? '', i.donated_by ?? ''])
  );

  return json({ items, photoCounts, noticeCounts, firstPhoto, people, canManage, self: email });
};

export const POST: APIRoute = async ({ cookies, request }) => {
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

  const normalized = normalizeItemSubmission(body);
  if (!normalized.ok) return json({ error: normalized.error }, 400);

  const email = emailOf(gate);
  const { data, error } = await db
    .from('lost_found_items')
    .insert({
      ...normalized.value,
      logged_by: email,
      logged_by_name: displayName({ ...gate.user, email }),
    })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  const item = data as LostFoundItemRow;

  await logLostFoundEvent(db, {
    itemId: item.id,
    action: 'created',
    actor: email,
    detail: {
      title: item.title,
      found_at: item.found_at,
      chosen_sessions: item.chosen_session_ids?.length ?? 0,
      owner_email: item.owner_email,
    },
  });

  return json({ item }, 201);
};

/** Columns a status move writes alongside `status`, and who may make it. */
function statusTransition(
  next: string,
  email: string,
  note: string | null
): { patch: Record<string, unknown>; needsManage: boolean } | null {
  const now = new Date().toISOString();
  switch (next) {
    case 'picked_up':
      return {
        patch: { status: next, picked_up_at: now, picked_up_by: email, picked_up_note: note },
        needsManage: false,
      };
    case 'donated':
      // Reaches outside the building and is irreversible in the real world.
      return { patch: { status: next, donated_at: now, donated_by: email }, needsManage: true };
    case 'discarded':
      return { patch: { status: next }, needsManage: false };
    case 'claimed':
      // Confirming a claim staff took over the phone or at the desk.
      return { patch: { status: next }, needsManage: false };
    case 'unclaimed':
      // Reopening: a claim fell through, or the donation run was called off.
      return {
        patch: { status: next, claimed_by_email: null, claimed_by_name: null, claimed_at: null },
        needsManage: false,
      };
    default:
      return null;
  }
}

export const PATCH: APIRoute = async ({ cookies, request }) => {
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

  const { data: current, error: readError } = await db
    .from('lost_found_items')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (readError) return json({ error: readError.message }, 500);

  const item = (current as LostFoundItemRow) ?? null;
  if (!item) return json({ error: 'Item not found' }, 404);

  const email = emailOf(gate);
  const canManage = hasLostFoundManage(gate.access);
  const note =
    typeof body.note === 'string' && body.note.trim()
      ? body.note.trim().slice(0, FIELD_LIMITS.note)
      : null;

  // A status move and a field edit are different acts with different audit
  // lines, so they are handled separately rather than merged into one update.
  if (typeof body.status === 'string') {
    if (!(STAFF_SETTABLE_STATUSES as readonly string[]).includes(body.status)) {
      return json({ error: 'That status is not settable by hand' }, 400);
    }
    const transition = statusTransition(body.status, email, note);
    if (!transition) return json({ error: 'Unknown status' }, 400);
    if (transition.needsManage && !canManage) {
      return json({ error: 'Recording a donation needs the lost-found:manage permission' }, 403);
    }
    if (item.status === body.status) return json({ item });

    const { data: updated, error } = await db
      .from('lost_found_items')
      .update({ ...transition.patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) return json({ error: error.message }, 500);

    const action =
      body.status === 'picked_up'
        ? 'picked_up'
        : body.status === 'donated'
          ? 'donated'
          : body.status === 'discarded'
            ? 'discarded'
            : 'status_changed';

    await logLostFoundEvent(db, {
      itemId: id,
      action,
      actor: email,
      detail: { from: item.status, to: body.status },
      note,
    });

    return json({ item: updated as LostFoundItemRow });
  }

  const normalized = normalizeItemPatch(body);
  if (!normalized.ok) return json({ error: normalized.error }, 400);

  const diff = diffItemFields(
    item as unknown as Record<string, unknown>,
    normalized.value as Record<string, unknown>
  );
  if (Object.keys(diff).length === 0) return json({ item });

  const { data: updated, error } = await db
    .from('lost_found_items')
    .update({ ...normalized.value, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  await logLostFoundEvent(db, {
    itemId: id,
    action: 'updated',
    actor: email,
    detail: diff,
    note,
  });

  return json({ item: updated as LostFoundItemRow });
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

  // Attachments cascade in the database; their objects would not, so they go
  // first and explicitly.
  const attachments = await loadAttachments(db, id);
  if (attachments.length > 0) {
    await db.storage.from(LOST_FOUND_BUCKET).remove(attachments.map((a) => a.storage_path));
  }

  const { error } = await db.from('lost_found_items').delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
};
