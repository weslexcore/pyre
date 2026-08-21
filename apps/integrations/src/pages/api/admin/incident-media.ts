// Photos, video, and documents for incident reports.
//
// POST takes one file as multipart/form-data, puts it in the private
// incident-media bucket, and records an incident_attachments row. GET
// exchanges an attachment id for a short-lived signed URL — by default as a
// redirect, so an <img>/<video> src can point straight at this route and
// always get a fresh link. DELETE removes the object and its row.
//
// Nothing in the bucket is publicly readable: the media shows guests,
// injuries, and sometimes medical detail, so every read passes the same gate
// as the report it belongs to. Uploads go through the function rather than a
// direct-to-storage signed URL so the size, MIME type, and per-incident count
// are all enforced server-side, and the attachment row and the object are
// created together.

import type { APIRoute } from 'astro';
import { hasIncidentsManage } from '@/components/admin/adminTools';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import type { IncidentAttachmentRow, IncidentRow } from '@/lib/db';
import { getDb } from '@/lib/db';
import { logIncidentEvent } from '@/lib/incidents/log';
import {
  buildStoragePath,
  formatBytes,
  kindForMime,
  MAX_ATTACHMENTS_PER_INCIDENT,
  MAX_FILE_BYTES,
} from '@/lib/incidents/media';
import { FIELD_LIMITS } from '@/lib/incidents/validate';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const PAGE = '/admin/incidents';
const BUCKET = 'incident-media';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Long enough to load a page of media, short enough that a leaked link dies. */
const SIGNED_URL_TTL_SECONDS = 600;

/** Matches the reporter's amendment window in incidents.ts. */
const ATTACH_WINDOW_MINUTES = 60;

type Db = NonNullable<ReturnType<typeof getDb>>;

const emailOf = (gate: { user: { email: string } }): string =>
  (gate.user.email ?? '').trim().toLowerCase();

/**
 * The incident this request is about, plus whether the caller may attach to
 * it. Managers always may; the reporter may while their report is fresh, so
 * "file now, add the photo once the guest is settled" works — which is the
 * order these things actually happen in.
 */
async function resolveIncident(
  db: Db,
  incidentId: string,
  email: string,
  canManage: boolean
): Promise<{ incident: IncidentRow; canAttach: boolean } | null> {
  const { data } = await db.from('incidents').select('*').eq('id', incidentId).maybeSingle();
  const incident = (data as IncidentRow) ?? null;
  if (!incident) return null;
  if (!canManage && incident.reported_by !== email) return null;

  if (canManage) return { incident, canAttach: incident.status !== 'voided' };

  const age = Date.now() - Date.parse(incident.reported_at);
  const fresh = Number.isFinite(age) && age >= 0 && age <= ATTACH_WINDOW_MINUTES * 60_000;
  return { incident, canAttach: fresh && incident.status === 'submitted' };
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  if (!request.headers.get('content-type')?.includes('multipart/form-data')) {
    return json({ error: 'Content-Type must be multipart/form-data' }, 415);
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Could not read the upload' }, 400);
  }

  const incidentId = String(form.get('incidentId') ?? '');
  if (!UUID_RE.test(incidentId)) return json({ error: 'incidentId must be a UUID' }, 400);

  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'No file was uploaded' }, 400);

  const email = emailOf(gate);
  const canManage = hasIncidentsManage(gate.access);
  const resolved = await resolveIncident(db, incidentId, email, canManage);
  if (!resolved) return json({ error: 'Incident not found' }, 404);
  if (!resolved.canAttach) {
    return json(
      { error: 'This report is no longer open for attachments — ask a reviewer to add it.' },
      403
    );
  }

  const kind = kindForMime(file.type);
  if (!kind) return json({ error: `Unsupported file type: ${file.type || 'unknown'}` }, 415);
  if (file.size === 0) return json({ error: 'That file is empty' }, 400);
  if (file.size > MAX_FILE_BYTES) {
    return json(
      {
        error: `That file is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_FILE_BYTES)}`,
      },
      413
    );
  }

  const { count, error: countError } = await db
    .from('incident_attachments')
    .select('id', { count: 'exact', head: true })
    .eq('incident_id', incidentId);
  if (countError) return json({ error: countError.message }, 500);
  if ((count ?? 0) >= MAX_ATTACHMENTS_PER_INCIDENT) {
    return json(
      { error: `A report can hold ${MAX_ATTACHMENTS_PER_INCIDENT} attachments at most` },
      409
    );
  }

  const fileName = (file.name || `${kind}.bin`).slice(0, FIELD_LIMITS.shortText);
  const storagePath = buildStoragePath(incidentId, fileName, file.type);

  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    console.error('[incidents] upload failed:', uploadError.message);
    return json({ error: `Upload failed: ${uploadError.message}` }, 502);
  }

  const captionRaw = form.get('caption');
  const caption =
    typeof captionRaw === 'string' && captionRaw.trim()
      ? captionRaw.trim().slice(0, FIELD_LIMITS.caption)
      : null;

  const { data, error } = await db
    .from('incident_attachments')
    .insert({
      incident_id: incidentId,
      storage_path: storagePath,
      file_name: fileName,
      mime_type: file.type,
      size_bytes: file.size,
      kind,
      caption,
      uploaded_by: email,
    })
    .select('*')
    .single();

  if (error) {
    // Don't leave an orphan object behind when the row fails.
    await db.storage.from(BUCKET).remove([storagePath]);
    return json({ error: error.message }, 500);
  }

  const attachment = data as IncidentAttachmentRow;
  await logIncidentEvent(db, {
    incidentId,
    action: 'attachment_added',
    actor: email,
    detail: { file_name: fileName, kind, size_bytes: file.size },
  });

  return json({ attachment }, 201);
};

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id || !UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);

  const { data, error } = await db
    .from('incident_attachments')
    .select('*, incidents(reported_by)')
    .eq('id', id)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);

  const row = data as
    | (IncidentAttachmentRow & { incidents: { reported_by: string } | null })
    | null;
  const canManage = hasIncidentsManage(gate.access);
  if (!row || (!canManage && row.incidents?.reported_by !== emailOf(gate))) {
    return json({ error: 'Attachment not found' }, 404);
  }

  const { data: signed, error: signError } = await db.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS, {
      download: url.searchParams.get('download') === '1' ? row.file_name : undefined,
    });
  if (signError || !signed?.signedUrl) {
    return json({ error: signError?.message ?? 'Could not sign that file' }, 502);
  }

  if (url.searchParams.get('format') === 'json') {
    return json({ url: signed.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS, attachment: row });
  }

  // Default: bounce straight to the object, so an <img>/<video> src can be
  // this route and never hold a stale signature.
  return new Response(null, {
    status: 302,
    headers: { Location: signed.signedUrl, 'Cache-Control': 'private, no-store' },
  });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id || !UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);

  const { data, error } = await db
    .from('incident_attachments')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);

  const attachment = (data as IncidentAttachmentRow) ?? null;
  if (!attachment) return json({ error: 'Attachment not found' }, 404);

  const email = emailOf(gate);
  const canManage = hasIncidentsManage(gate.access);
  const resolved = await resolveIncident(db, attachment.incident_id, email, canManage);
  if (!resolved) return json({ error: 'Attachment not found' }, 404);
  // Removing evidence is a reviewer's call once the window has closed; inside
  // it, the person who uploaded a blurry shot can drop it themselves.
  if (!canManage && !(resolved.canAttach && attachment.uploaded_by === email)) {
    return json({ error: 'This attachment can no longer be removed' }, 403);
  }

  const { error: storageError } = await db.storage.from(BUCKET).remove([attachment.storage_path]);
  if (storageError) {
    console.error('[incidents] media delete failed:', storageError.message);
  }

  const { error: deleteError } = await db.from('incident_attachments').delete().eq('id', id);
  if (deleteError) return json({ error: deleteError.message }, 500);

  await logIncidentEvent(db, {
    incidentId: attachment.incident_id,
    action: 'attachment_removed',
    actor: email,
    detail: { file_name: attachment.file_name, kind: attachment.kind },
  });

  return json({ ok: true });
};
