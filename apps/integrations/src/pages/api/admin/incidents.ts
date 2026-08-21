// Incident reporting API. GET reads the log (or one report with its
// attachments and audit trail), POST files a new report, PATCH edits /
// changes status / appends a follow-up note, DELETE removes a report
// outright (admin only, for test rows).
//
// Permissions, in one place because they are the point of the feature:
//   * Anyone granted /admin/incidents may FILE a report and read back the
//     reports they filed. That is the bathhouse attendant's level: an
//     incident report carries guest names, phone numbers, and injury detail,
//     so reading the whole log is not the same act as filing one.
//   * incidents:manage (or admin) reads and edits everything, changes status,
//     and resolves.
//   * The reporter may amend their own report for AMEND_WINDOW_MINUTES after
//     filing, while it is still 'submitted' — the realistic case is
//     remembering a detail on the walk back to the desk. After that the
//     record stands and corrections are appended as notes.
//   * Every mutation writes an incident_events row with before/after. Nothing
//     changes silently.
//
// Identity always comes from the session: reported_by, reviewed_by,
// resolved_by, and every audit actor are the authenticated email, never a
// value from the request body. Mutations are CSRF-guarded in-route (global
// checkOrigin stays off; see astro.config.mjs).

import type { APIRoute } from 'astro';
import { hasIncidentsManage } from '@/components/admin/adminTools';
import { assertSameOrigin, requireAdmin, requirePage } from '@/lib/auth/admin';
import type { IncidentAttachmentRow, IncidentRow } from '@/lib/db';
import { getDb } from '@/lib/db';
import { loadIncidentEvents, logIncidentEvent } from '@/lib/incidents/log';
import { isUrgent, notifyIncident } from '@/lib/incidents/notify';
import {
  INCIDENT_AREAS,
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  isIncidentStatus,
  OPEN_STATUSES,
} from '@/lib/incidents/types';
import {
  diffIncidentFields,
  FIELD_LIMITS,
  normalizeIncidentPatch,
  normalizeIncidentSubmission,
  REVIEW_ONLY_FIELDS,
} from '@/lib/incidents/validate';
// Generic despite the path — the roster name directory landed with the SOP
// tools and is not SOP-specific. Worth moving to lib/people once that work
// settles.
import { getPeopleNames } from '@/lib/sops/people';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const PAGE = '/admin/incidents';
const LIST_LIMIT = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How long after filing the reporter may still correct their own report. */
const AMEND_WINDOW_MINUTES = 60;

type Db = NonNullable<ReturnType<typeof getDb>>;

const emailOf = (gate: { user: { email: string } }): string =>
  (gate.user.email ?? '').trim().toLowerCase();

const displayName = (user: { firstName?: string; lastName?: string; email: string }): string =>
  [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email;

/** Whether `email` may still amend this report themselves. */
function withinAmendWindow(incident: IncidentRow, email: string): boolean {
  if (incident.reported_by !== email) return false;
  if (incident.status !== 'submitted') return false;
  const age = Date.now() - Date.parse(incident.reported_at);
  return Number.isFinite(age) && age >= 0 && age <= AMEND_WINDOW_MINUTES * 60_000;
}

async function loadAttachments(db: Db, incidentId: string): Promise<IncidentAttachmentRow[]> {
  const { data } = await db
    .from('incident_attachments')
    .select('*')
    .eq('incident_id', incidentId)
    .order('created_at', { ascending: true });
  return (data ?? []) as IncidentAttachmentRow[];
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const canManage = hasIncidentsManage(gate.access);
  const email = emailOf(gate);

  // One report, by id or by case number.
  const id = url.searchParams.get('id');
  const reference = url.searchParams.get('reference');
  if (id || reference) {
    if (id && !UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);

    let query = db.from('incidents').select('*');
    query = id ? query.eq('id', id) : query.eq('reference', (reference as string).toUpperCase());
    const { data, error } = await query.maybeSingle();
    if (error) return json({ error: error.message }, 500);

    const incident = (data as IncidentRow) ?? null;
    // Same 404 whether it doesn't exist or isn't theirs: a reporter shouldn't
    // be able to probe for the existence of other people's reports.
    if (!incident || (!canManage && incident.reported_by !== email)) {
      return json({ error: 'Incident not found' }, 404);
    }

    const [attachments, events] = await Promise.all([
      loadAttachments(db, incident.id),
      loadIncidentEvents(db, incident.id),
    ]);

    // Names for exactly the people this report mentions, so the record reads
    // "Sunny checked the guest" rather than an email local part.
    const people = await getPeopleNames([
      incident.reported_by,
      incident.reviewed_by ?? '',
      incident.resolved_by ?? '',
      ...events.map((e) => e.actor),
      ...attachments.map((a) => a.uploaded_by),
    ]);

    return json({
      incident,
      attachments,
      events,
      people,
      canManage,
      canAmend: canManage || withinAmendWindow(incident, email),
      self: email,
    });
  }

  // The log. Managers see everything; everyone else sees what they filed.
  let query = db
    .from('incidents')
    .select('*')
    .order('occurred_at', { ascending: false })
    .limit(LIST_LIMIT);

  if (!canManage) {
    if (!email) {
      return json({
        incidents: [],
        attachmentCounts: {},
        people: {},
        scope: 'mine',
        canManage: false,
        self: '',
      });
    }
    query = query.eq('reported_by', email);
  }

  const status = url.searchParams.get('status');
  if (status === 'open') {
    query = query.in('status', OPEN_STATUSES);
  } else if (status) {
    if (!isIncidentStatus(status)) return json({ error: 'Unknown status filter' }, 400);
    query = query.eq('status', status);
  }

  const severity = url.searchParams.get('severity');
  if (severity) {
    if (!(INCIDENT_SEVERITIES as readonly string[]).includes(severity)) {
      return json({ error: 'Unknown severity filter' }, 400);
    }
    query = query.eq('severity', severity);
  }

  const category = url.searchParams.get('category');
  if (category) {
    if (!(INCIDENT_CATEGORIES as readonly string[]).includes(category)) {
      return json({ error: 'Unknown category filter' }, 400);
    }
    query = query.eq('category', category);
  }

  const area = url.searchParams.get('area');
  if (area) {
    if (!(INCIDENT_AREAS as readonly string[]).includes(area)) {
      return json({ error: 'Unknown area filter' }, 400);
    }
    query = query.eq('area', area);
  }

  const since = url.searchParams.get('since');
  if (since) {
    if (Number.isNaN(Date.parse(since))) return json({ error: 'since must be a date' }, 400);
    query = query.gte('occurred_at', new Date(since).toISOString());
  }

  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);

  const incidents = (data ?? []) as IncidentRow[];

  // Attachment counts in one round trip so the log can show a camera badge
  // without fetching every attachment row's metadata per card.
  const counts: Record<string, number> = {};
  if (incidents.length > 0) {
    const { data: attachmentRows } = await db
      .from('incident_attachments')
      .select('incident_id')
      .in(
        'incident_id',
        incidents.map((i) => i.id)
      );
    for (const row of (attachmentRows ?? []) as { incident_id: string }[]) {
      counts[row.incident_id] = (counts[row.incident_id] ?? 0) + 1;
    }
  }

  const people = await getPeopleNames(
    incidents.flatMap((i) => [i.reported_by, i.reviewed_by ?? '', i.resolved_by ?? ''])
  );

  return json({
    incidents,
    attachmentCounts: counts,
    people,
    scope: canManage ? 'all' : 'mine',
    canManage,
    self: email,
  });
};

export const POST: APIRoute = async ({ cookies, request, url }) => {
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

  const normalized = normalizeIncidentSubmission(body);
  if (!normalized.ok) return json({ error: normalized.error }, 400);

  const email = emailOf(gate);
  const { data, error } = await db
    .from('incidents')
    .insert({
      ...normalized.value,
      reported_by: email,
      reported_by_name: displayName({ ...gate.user, email }),
    })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  const incident = data as IncidentRow;

  await logIncidentEvent(db, {
    incidentId: incident.id,
    action: 'created',
    actor: email,
    detail: {
      category: incident.category,
      severity: incident.severity,
      area: incident.area,
      occurred_at: incident.occurred_at,
    },
  });

  // The report is saved either way — alerting is best-effort on top of it.
  let notified = 0;
  if (isUrgent(incident)) {
    try {
      notified = await notifyIncident(db, incident, new URL(url).origin);
    } catch (e) {
      console.error('[incidents] alert failed:', e instanceof Error ? e.message : e);
    }
  }

  return json({ incident, notified }, 201);
};

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

  const action = typeof body.action === 'string' ? body.action : 'update';
  if (!['update', 'status', 'note'].includes(action)) {
    return json({ error: 'action must be update, status, or note' }, 400);
  }

  const { data, error } = await db.from('incidents').select('*').eq('id', id).maybeSingle();
  if (error) return json({ error: error.message }, 500);

  const incident = (data as IncidentRow) ?? null;
  const canManage = hasIncidentsManage(gate.access);
  const email = emailOf(gate);
  if (!incident || (!canManage && incident.reported_by !== email)) {
    return json({ error: 'Incident not found' }, 404);
  }

  // Appending a follow-up note is available to anyone who can see the report
  // — the reporter remembering a detail is exactly the case worth capturing.
  if (action === 'note') {
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, FIELD_LIMITS.note) : '';
    if (!note) return json({ error: 'note cannot be empty' }, 400);
    await logIncidentEvent(db, { incidentId: id, action: 'note_added', actor: email, note });
    return json({ incident, events: await loadIncidentEvents(db, id) });
  }

  if (action === 'status') {
    if (!canManage) return json({ error: 'Only reviewers can change status' }, 403);

    const next = body.status;
    if (!isIncidentStatus(next)) {
      return json({ error: `status must be one of ${INCIDENT_STATUSES.join(', ')}` }, 400);
    }
    if (next === incident.status) return json({ incident });

    const now = new Date().toISOString();
    const update: Record<string, unknown> = { status: next };

    // First time anyone looks at it, record who and when.
    if (!incident.reviewed_at) {
      update.reviewed_by = email;
      update.reviewed_at = now;
    }
    if (next === 'resolved' || next === 'closed') {
      update.resolved_by = email;
      update.resolved_at = now;
    } else if (incident.resolved_at) {
      // Reopening: clear the closure so the pair stays consistent (the table
      // constrains resolved_at and resolved_by to travel together).
      update.resolved_by = null;
      update.resolved_at = null;
    }

    const { data: updated, error: updateError } = await db
      .from('incidents')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    if (updateError) return json({ error: updateError.message }, 500);

    const note = typeof body.note === 'string' ? body.note.trim().slice(0, FIELD_LIMITS.note) : '';
    await logIncidentEvent(db, {
      incidentId: id,
      action: 'status_changed',
      actor: email,
      detail: { status: { from: incident.status, to: next } },
      note: note || null,
    });

    return json({ incident: updated as IncidentRow, events: await loadIncidentEvents(db, id) });
  }

  // action === 'update'
  const amending = withinAmendWindow(incident, email);
  if (!canManage && !amending) {
    return json(
      {
        error: `This report can no longer be edited (${AMEND_WINDOW_MINUTES}-minute window). Add a follow-up note instead.`,
      },
      403
    );
  }
  if (incident.status === 'voided' && !canManage) {
    return json({ error: 'This report has been voided' }, 409);
  }

  // A manager may edit the whole record; the reporter amending their own
  // report cannot reach into the review fields (follow-up, corrective
  // actions, resolution) — those are the reviewer's account of it.
  const reviewOnly = new Set<string>(REVIEW_ONLY_FIELDS);
  const allowed = canManage
    ? undefined
    : Object.keys(body).filter((k) => k !== 'id' && k !== 'action' && !reviewOnly.has(k));

  const normalized = normalizeIncidentPatch(body, allowed);
  if (!normalized.ok) return json({ error: normalized.error }, 400);

  const changes = diffIncidentFields(
    incident as unknown as Record<string, unknown>,
    normalized.value
  );
  if (Object.keys(changes).length === 0) return json({ incident });

  const { data: updated, error: updateError } = await db
    .from('incidents')
    .update(normalized.value)
    .eq('id', id)
    .select('*')
    .single();
  if (updateError) return json({ error: updateError.message }, 500);

  await logIncidentEvent(db, {
    incidentId: id,
    action: 'updated',
    actor: email,
    detail: changes,
    note: amending && !canManage ? 'Amended by the reporter shortly after filing' : null,
  });

  return json({ incident: updated as IncidentRow, events: await loadIncidentEvents(db, id) });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  // Deleting erases the report, its audit trail, and its attachment rows.
  // That is the opposite of what this system is for, so it is admin-only and
  // exists for test rows; a mistaken real report is voided instead, which
  // keeps the original text readable.
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id || !UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);

  // Storage objects are not covered by the row cascade, so clear them first;
  // a failure here means orphaned media, not a failed delete.
  const attachments = await loadAttachments(db, id);
  if (attachments.length > 0) {
    const { error: storageError } = await db.storage
      .from('incident-media')
      .remove(attachments.map((a) => a.storage_path));
    if (storageError) {
      console.error('[incidents] media cleanup failed:', storageError.message);
    }
  }

  const { data, error } = await db
    .from('incidents')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: 'Incident not found' }, 404);

  return json({ ok: true });
};
