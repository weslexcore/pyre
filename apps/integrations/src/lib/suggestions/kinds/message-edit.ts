// message.edit: new wording for an existing admin message, saved by the
// approving admin the way the message editor saves it — guarded by the
// updated_at the edit was made against, so a newer save is never
// overwritten, and telling anyone the new text newly @-mentions.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAccess } from '@/lib/auth/access';
import type { AdminMessageRow } from '@/lib/db';
import { normalizeEmail } from '@/lib/email/address';
import { canChangeMessage, isDraft } from '@/lib/messages/access';
import { notifyMessageEdited } from '@/lib/notifications/messages';
import { getSopRole } from '@/lib/sops/role';
import { messageHref, PAYLOAD_PARSERS } from '../types';
import type { KindHandler } from './handler';

async function loadMessage(db: SupabaseClient, id: string): Promise<AdminMessageRow | null> {
  const { data } = await db.from('admin_messages').select('*').eq('id', id).maybeSingle();
  return (data as AdminMessageRow | null) ?? null;
}

export const messageEdit: KindHandler<'message.edit'> = {
  parse: PAYLOAD_PARSERS['message.edit'],

  async validate(db, payload) {
    const message = await loadMessage(db, payload.messageId);
    if (!message) return { ok: false, status: 404, error: 'That message no longer exists' };
    if (message.archived_at) {
      return { ok: false, status: 422, error: 'That message is archived; unarchive it to edit it' };
    }
    if (payload.title === message.title && payload.bodyMd === message.body_md) {
      return { ok: false, status: 422, error: 'The edit changes nothing' };
    }
    // An edit checked for the first time is made against the message as it
    // stands; after that, a newer save means someone else changed it since.
    const base = payload.baseUpdatedAt || message.updated_at;
    if (base !== message.updated_at) {
      return {
        ok: false,
        status: 409,
        error:
          'Someone saved this message since the edit was suggested. Open it to see their changes, then make the edit against them.',
      };
    }
    return {
      ok: true,
      payload: {
        ...payload,
        baseUpdatedAt: base,
        previousTitle: message.title,
        previousBodyMd: message.body_md,
        sent: !isDraft(message),
      },
      target: { type: 'admin_message', id: message.id },
    };
  },

  async apply(db, payload, context) {
    const message = await loadMessage(db, payload.messageId);
    if (!message) throw new Error('That message no longer exists');
    const result = {
      resultType: 'admin_message' as const,
      resultId: message.id,
      label: payload.title,
      href: messageHref(message.id),
    };
    // A retry after a crash finds the wording the first attempt saved.
    if (message.title === payload.title && message.body_md === payload.bodyMd) return result;

    const actor = normalizeEmail(context.actor);
    const access = await getAccess(actor);
    const viewer = {
      role: access ? await getSopRole(actor, access) : ('staff' as const),
      email: actor,
    };
    if (!canChangeMessage(viewer, message)) {
      throw new Error(
        isDraft(message)
          ? 'Only the draft’s author and the admins it is shared with can change it'
          : 'Only admins edit messages; ask an admin to approve this'
      );
    }

    const { data, error } = await db
      .from('admin_messages')
      .update({ title: payload.title, body_md: payload.bodyMd, updated_by: actor })
      .eq('id', message.id)
      .eq('updated_at', payload.baseUpdatedAt)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Someone saved this message at the same time; reload and try again');
    const saved = data as AdminMessageRow;
    if (!isDraft(saved) && saved.body_md !== message.body_md) {
      await notifyMessageEdited(db, saved, message.body_md, actor).catch((e) =>
        console.error('[suggestions] message edit mention notice failed:', e)
      );
    }
    return result;
  },
};
