// Files answering a card's `files` fields, for signed-in staff.
//
//   POST   multipart { boardId, field, file } → { attachment } 201
//   GET    ?card=<uuid>                       → { attachments }
//   GET    ?id=<uuid>[&download=1][&format=json] → 302 to a signed URL
//   DELETE ?id=<uuid>                         → { ok: true }  (staged rows only)
//
// An upload is always *staged*: the drawer sends a file the moment it is
// picked and then saves the answer that names it, and the card claims the
// row when that answer lands (api/admin/board-cards.ts). Removing a file
// from a card is likewise an answer edit, not a DELETE here; DELETE only
// un-picks a staged row, for a drawer closed before its answer saved.
//
// Access is the board's: `board:<slug>` reaches exactly that board's files,
// for uploading as much as for reading back. Nothing in the bucket is
// publicly readable — GET mints a short-lived signed URL per view, by
// default as a redirect so an <a href> can point straight at this route.

import { BOARDS_HREF } from '@/components/admin/adminTools';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { canViewBoard } from '@/lib/boards/access';
import {
  loadAttachment,
  loadCardAttachments,
  removeAttachments,
  signAttachment,
  storeAttachment,
} from '@/lib/boards/card-media';
import { summaryOf } from '@/lib/boards/files';
import {
  type APIRoute,
  beginDelete,
  beginRead,
  type Db,
  isUuidParam,
  json,
  storeError,
} from '@/lib/boards/route';
import { loadCard, loadFields } from '@/lib/boards/store';
import { KEY_RE } from '@/lib/boards/types';
import type { BoardRow } from '@/lib/db';
import { getDb } from '@/lib/db';

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, BOARDS_HREF);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  if (!request.headers.get('content-type')?.includes('multipart/form-data')) {
    return json({ error: 'Content-Type must be multipart/form-data' }, 415);
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const email = (gate.user.email ?? '').trim().toLowerCase();
  if (!email) return json({ error: 'Session has no email' }, 400);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Could not read the upload' }, 400);
  }

  const boardId = String(form.get('boardId') ?? '');
  if (!isUuidParam(boardId)) return json({ error: 'boardId must be a UUID' }, 400);
  const fieldKey = String(form.get('field') ?? '');
  if (!KEY_RE.test(fieldKey)) return json({ error: 'field must be a field key' }, 400);
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'No file was uploaded' }, 400);

  try {
    const board = await loadBoard(db, boardId);
    // Not-found and not-yours look the same, as on the card routes.
    if (!board || !canViewBoard(gate.access, board.slug)) {
      return json({ error: 'Board not found' }, 404);
    }
    const field = (await loadFields(db, board.id)).find((entry) => entry.key === fieldKey);
    if (field?.kind !== 'files' || field.archived) {
      return json({ error: 'That field does not take files' }, 400);
    }

    const stored = await storeAttachment(db, {
      boardId: board.id,
      fieldKey,
      file,
      uploadedBy: email,
      cap: 'uploader',
    });
    if ('error' in stored) return json({ error: stored.error }, stored.status);
    return json({ attachment: summaryOf(stored) }, 201);
  } catch (e) {
    return storeError('board-media', e);
  }
};

export const GET: APIRoute = async ({ cookies, url }) => {
  const ready = await beginRead(cookies, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, gate } = ready;

  try {
    const cardId = url.searchParams.get('card');
    if (cardId !== null) {
      if (!isUuidParam(cardId)) return json({ error: 'card must be a UUID' }, 400);
      const card = await loadCard(db, cardId);
      if (!card || !(await canReachBoard(db, card.board_id, gate.access))) {
        return json({ error: 'Card not found' }, 404);
      }
      const rows = await loadCardAttachments(db, cardId);
      return json({ attachments: rows.map(summaryOf) });
    }

    const id = url.searchParams.get('id');
    if (!isUuidParam(id)) return json({ error: 'id must be a UUID' }, 400);
    const row = await loadAttachment(db, id);
    if (!row || !(await canReachBoard(db, row.board_id, gate.access))) {
      return json({ error: 'File not found' }, 404);
    }

    const signed = await signAttachment(db, row, url.searchParams.get('download') === '1');
    if (url.searchParams.get('format') === 'json') {
      return json({ ...signed, attachment: summaryOf(row) });
    }
    // Bounce straight to the object, so a link can be this route and never
    // hold a stale signature.
    return new Response(null, {
      status: 302,
      headers: { Location: signed.url, 'Cache-Control': 'private, no-store' },
    });
  } catch (e) {
    return storeError('board-media', e);
  }
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const ready = await beginDelete(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, gate } = ready;

  const id = url.searchParams.get('id');
  if (!isUuidParam(id)) return json({ error: 'id must be a UUID' }, 400);

  try {
    const row = await loadAttachment(db, id);
    if (!row || !(await canReachBoard(db, row.board_id, gate.access))) {
      return json({ error: 'File not found' }, 404);
    }
    // A claimed row is part of a card's answer; it leaves through the
    // answer, so the two can never disagree.
    if (row.card_id !== null) {
      return json({ error: 'Remove the file from the card instead' }, 409);
    }
    await removeAttachments(db, [row]);
    return json({ ok: true });
  } catch (e) {
    return storeError('board-media', e);
  }
};

async function loadBoard(db: Db, boardId: string): Promise<BoardRow | null> {
  const { data, error } = await db.from('boards').select('*').eq('id', boardId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BoardRow) ?? null;
}

/** Whether this access opens the board a file (or a card) is on. */
async function canReachBoard(
  db: Db,
  boardId: string,
  access: { isAdmin: boolean; pages: string[] }
): Promise<boolean> {
  const { data } = await db.from('boards').select('slug').eq('id', boardId).maybeSingle();
  const slug = (data as { slug: string } | null)?.slug;
  return !!slug && canViewBoard(access, slug);
}
