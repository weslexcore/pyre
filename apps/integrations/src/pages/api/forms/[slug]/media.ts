// A file picked on a board's form, before the form is sent. The upload
// half of api/forms/[slug].ts, gated the same way:
//
//   * public — no session. The per-address counter stands in for one, on
//     its own key: a form is sent once, but a picker is used a few times.
//   * admin — a session cookie, same-origin, and a grant that can view the
//     board.
//
//   POST   multipart { field, file } → { attachment } 201
//   DELETE ?id=<uuid>                → { ok: true }   (staged rows only)
//
// Either way the row is staged: it belongs to no card until the submission
// naming it lands, and the card the submission becomes claims it then. A
// row the form never sent is swept a day later. Nothing here reads a file
// back — a form page can add a file to the answer it is about to send and
// nothing more.

import { getAccess } from '@/lib/auth/access';
import { assertSameOrigin } from '@/lib/auth/admin';
import { validateSession } from '@/lib/auth/session';
import { canViewBoard } from '@/lib/boards/access';
import { loadAttachment, removeAttachments, storeAttachment } from '@/lib/boards/card-media';
import { summaryOf, UPLOAD_RATE } from '@/lib/boards/files';
import { clientIp, isRateLimited } from '@/lib/boards/form-guard';
import { formConfigOf, formQuestions } from '@/lib/boards/forms';
import { type APIRoute, isUuidParam, json } from '@/lib/boards/route';
import { loadBoardBySlug, loadFields, loadForm } from '@/lib/boards/store';
import { isBoardSlug, KEY_RE } from '@/lib/boards/types';
import type { BoardFormRow, BoardRow } from '@/lib/db';
import { getDb } from '@/lib/db';

/** The actor on a public upload. */
const FORM_ACTOR = 'form';

function uploadRateKey(ip: string): string {
  return `forms:rl:media:ip:${ip}`;
}

type Db = NonNullable<ReturnType<typeof getDb>>;

/**
 * The open form at this slug and who is using it: the session email for a
 * staff form, 'form' for a public one. The same door as the submission.
 */
async function openForm(
  db: Db,
  slug: string,
  request: Request,
  cookies: Parameters<typeof validateSession>[0],
  clientAddress: () => string
): Promise<{ board: BoardRow; row: BoardFormRow; actor: string } | Response> {
  const board = await loadBoardBySlug(db, slug);
  if (!board || board.archived) return json({ error: 'Form not found' }, 404);
  const row = await loadForm(db, board.id);
  if (!row) return json({ error: 'Form not found' }, 404);
  if (!row.enabled) return json({ error: 'This form is closed' }, 410);

  if (row.access === 'public') {
    const key = uploadRateKey(clientIp(request, clientAddress));
    if (await isRateLimited(key, UPLOAD_RATE.limit, UPLOAD_RATE.windowSeconds)) {
      return json({ error: 'Too many uploads from this address. Try again later.' }, 429);
    }
    return { board, row, actor: FORM_ACTOR };
  }

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { session } = await validateSession(cookies);
  const email = session.isAuthenticated ? (session.user?.email ?? '').trim().toLowerCase() : '';
  if (!email) return json({ error: 'Sign in to send this form' }, 401);
  const access = await getAccess(email);
  if (!access || !canViewBoard(access, slug)) return json({ error: 'Form not found' }, 404);
  return { board, row, actor: email };
}

export const POST: APIRoute = async ({ params, request, cookies, clientAddress }) => {
  const slug = params.slug;
  if (!isBoardSlug(slug)) return json({ error: 'Form not found' }, 404);
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
  const fieldKey = String(form.get('field') ?? '');
  if (!KEY_RE.test(fieldKey)) return json({ error: 'field must be a field key' }, 400);
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'No file was uploaded' }, 400);

  try {
    const opened = await openForm(db, slug, request, cookies, () => clientAddress);
    if (opened instanceof Response) return opened;
    const { board, row, actor } = opened;

    // Only a field the form asks, so a hidden field cannot be written
    // through the form's door — the rule parseSubmission applies to answers.
    const question = formQuestions(formConfigOf(row), await loadFields(db, board.id)).find(
      (entry) => entry.kind === 'field' && entry.key === fieldKey
    );
    if (question?.field?.kind !== 'files') {
      return json({ error: 'This form does not ask for that file' }, 400);
    }

    const stored = await storeAttachment(db, {
      boardId: board.id,
      fieldKey,
      file,
      uploadedBy: actor,
      cap: actor === FORM_ACTOR ? 'board' : 'uploader',
    });
    if ('error' in stored) return json({ error: stored.error }, stored.status);
    return json({ attachment: summaryOf(stored) }, 201);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[forms] upload failed:', message);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
};

export const DELETE: APIRoute = async ({ params, request, cookies, url, clientAddress }) => {
  const slug = params.slug;
  if (!isBoardSlug(slug)) return json({ error: 'Form not found' }, 404);
  const id = url.searchParams.get('id');
  if (!isUuidParam(id)) return json({ error: 'id must be a UUID' }, 400);

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  try {
    const opened = await openForm(db, slug, request, cookies, () => clientAddress);
    if (opened instanceof Response) return opened;

    // Only a staged row on this board: a file already on a card is the
    // card's, and a stranger holding an id cannot take it off one.
    const row = await loadAttachment(db, id);
    if (!row || row.board_id !== opened.board.id || row.card_id !== null) {
      return json({ error: 'File not found' }, 404);
    }
    await removeAttachments(db, [row]);
    return json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[forms] upload removal failed:', message);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
};
