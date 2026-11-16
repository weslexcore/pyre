// Acknowledging an admin message: the "I've read this" check-off on a
// message the admin sent with "require acknowledgment" on. Anyone who can
// open the message (and didn't write it) may acknowledge it while it's sent
// and not archived (lib/messages/access canAcknowledgeMessage). Identity
// always comes from the session.
//
// Acknowledging is one-way — there is no DELETE — so the record holds
// people to what they confirmed they read. Acknowledging twice is a no-op
// that returns the first timestamp. Reads ride on the messages route
// (GET /api/admin/messages?id= returns `ack`).
//
//   POST { messageId } → { acknowledgedAt }

import type { APIRoute } from 'astro';
import { requireStaff } from '@/lib/auth/admin';
import type { AdminMessageAckRow, AdminMessageRow } from '@/lib/db';
import { normalizeEmail } from '@/lib/email/address';
import { beginMutation, dbError, isUuid, json } from '@/lib/http/route';
import { canAcknowledgeMessage, canViewMessage } from '@/lib/messages/access';
import { markSourceRead } from '@/lib/notifications/notify';
import { getSopRole } from '@/lib/sops/role';

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, requireStaff);
  if (ready instanceof Response) return ready;
  const { gate, db, body } = ready;
  const viewer = {
    role: await getSopRole(gate.user.email ?? null, gate.access),
    email: normalizeEmail(gate.user.email),
  };

  const messageId = typeof body.messageId === 'string' ? body.messageId : '';
  if (!isUuid(messageId)) return json({ error: 'messageId must be a UUID' }, 400);

  const { data, error } = await db
    .from('admin_messages')
    .select('*')
    .eq('id', messageId)
    .maybeSingle();
  if (error) return dbError(error);
  const message = (data as AdminMessageRow | null) ?? null;
  if (!message || !canViewMessage(viewer, message)) {
    return json({ error: 'Message not found' }, 404);
  }
  if (!canAcknowledgeMessage(viewer, message)) {
    const why = !message.requires_ack
      ? "This message doesn't ask for acknowledgment"
      : message.author_email === viewer.email
        ? 'You wrote this message'
        : message.archived_at
          ? 'This message is archived'
          : 'This message has not been sent';
    return json({ error: why }, 409);
  }

  // The first acknowledgment stands; a second press keeps its timestamp.
  const { error: insertError } = await db
    .from('admin_message_acks')
    .upsert(
      { message_id: messageId, email: viewer.email },
      { onConflict: 'message_id,email', ignoreDuplicates: true }
    );
  if (insertError) return dbError(insertError);
  const { data: row, error: readError } = await db
    .from('admin_message_acks')
    .select('*')
    .eq('message_id', messageId)
    .eq('email', viewer.email)
    .single();
  if (readError) return dbError(readError);

  await markSourceRead(db, viewer.email, 'admin_message', messageId);
  return json({ acknowledgedAt: (row as AdminMessageAckRow).acknowledged_at });
};
