// The SOP writing assistant behind the document editor (lib/sops/assist.ts).
// POST { sopId, mode: 'draft' | 'review', title, content, notes? } returns
// { proposal }: a revised title and body for the editor to diff and accept
// or discard. Nothing is written here; accepting puts the text in the editor
// and the usual PUT /api/admin/sops saves it.
//
// Same gate as saving: the /admin/sops page grant plus edit access to this
// document, since a proposal is only useful to someone who can save it. The
// title and body come from the request because the editor's unsaved text is
// what is being worked on.

import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { normalizeEmail } from '@/lib/email/address';
import { gateMutation, isUuid, json, readJsonBody } from '@/lib/http/route';
import {
  type AssistMode,
  loadAssistContext,
  MAX_ASSIST_NOTES,
  runSopAssist,
  sopAssistAvailable,
} from '@/lib/sops/assist';
import { loadSop } from '@/lib/sops/document';
import { canEditSop, canViewSop, type SopViewer } from '@/lib/sops/levels';
import { getSopRole } from '@/lib/sops/role';
import { MAX_SOP_CONTENT, MAX_SOP_TITLE } from '@/lib/sops/save-version';

const PAGE = '/admin/sops';

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await gateMutation(cookies, request, PAGE);
  if (gate instanceof Response) return gate;
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  if (!sopAssistAvailable()) {
    return json({ error: 'The writing assistant is unavailable (AI Gateway not configured)' }, 503);
  }
  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const mode = body.mode;
  if (mode !== 'draft' && mode !== 'review') {
    return json({ error: "mode must be 'draft' or 'review'" }, 400);
  }
  const sopId = typeof body.sopId === 'string' ? body.sopId : '';
  if (!isUuid(sopId)) return json({ error: 'sopId must be a UUID' }, 400);

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > MAX_SOP_TITLE) {
    return json({ error: `title is required (max ${MAX_SOP_TITLE} chars)` }, 400);
  }
  const content = typeof body.content === 'string' ? body.content : '';
  if (content.length > MAX_SOP_CONTENT) {
    return json({ error: `content is too long (max ${MAX_SOP_CONTENT} chars)` }, 400);
  }
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (mode === 'draft' && !notes) {
    return json({ error: 'Add some notes for the assistant to write up' }, 400);
  }
  if (notes.length > MAX_ASSIST_NOTES) {
    return json({ error: `notes are too long (max ${MAX_ASSIST_NOTES} chars)` }, 400);
  }
  if (mode === 'review' && !content.trim()) {
    return json({ error: 'There is nothing to review yet' }, 400);
  }

  const { sop, error: loadError } = await loadSop(db, { id: sopId });
  if (loadError) return json({ error: loadError }, 500);
  const viewer: SopViewer = {
    role: await getSopRole(gate.user.email ?? null, gate.access),
    email: normalizeEmail(gate.user.email),
  };
  if (!sop || !canViewSop(viewer, sop)) return json({ error: 'SOP not found' }, 404);
  if (!canEditSop(viewer, sop)) {
    return json({ error: 'You do not have edit access to this SOP' }, 403);
  }

  const { context, error: contextError } = await loadAssistContext(db, viewer, sop);
  if (contextError) return json({ error: contextError }, 500);

  try {
    const proposal = await runSopAssist({
      mode: mode as AssistMode,
      sop,
      title,
      content,
      notes,
      context,
    });
    return json({ proposal });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sop-assist] ${mode} ${sop.slug}:`, message);
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return json(
      {
        error: timedOut
          ? 'The assistant took too long. Try again, or work on a shorter section.'
          : 'The assistant could not finish. Try again in a moment.',
      },
      502
    );
  }
};
