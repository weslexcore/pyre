// message.create: a new admin message, saved by the approving admin as a
// draft of their own. Sending it — which tells and emails the audience — stays
// a deliberate press of Send in the composer, so approving a suggestion never
// reaches the whole team by itself. Only admins write messages, so only an
// admin can approve one.

import { getAccess } from '@/lib/auth/access';
import type { AdminMessageRow } from '@/lib/db';
import { checkedAudience } from '@/lib/messages/roster';
import { messageHref, PAYLOAD_PARSERS } from '../types';
import type { KindHandler } from './handler';

export const messageCreate: KindHandler<'message.create'> = {
  parse: PAYLOAD_PARSERS['message.create'],

  async validate(_db, payload) {
    const audience = await checkedAudience(payload.audienceRoles, payload.audienceEmails);
    if ('error' in audience) return { ok: false, status: 422, error: audience.error };
    return {
      ok: true,
      payload: { ...payload, audienceRoles: audience.roles, audienceEmails: audience.emails },
      target: null,
    };
  },

  async apply(db, payload, context) {
    // A retry after a crash finds the draft the first attempt saved.
    const { data: existing } = await db
      .from('admin_messages')
      .select('id, title')
      .eq('suggestion_id', context.suggestion.id)
      .maybeSingle();
    if (existing) {
      const found = existing as Pick<AdminMessageRow, 'id' | 'title'>;
      return {
        resultType: 'admin_message',
        resultId: found.id,
        label: `${found.title} (draft)`,
        href: messageHref(found.id),
      };
    }

    const access = await getAccess(context.actor);
    if (!access?.isAdmin)
      throw new Error('Only admins write messages; ask an admin to approve this');

    const { data, error } = await db
      .from('admin_messages')
      .insert({
        title: payload.title,
        body_md: payload.bodyMd,
        author_email: context.actor,
        audience_roles: payload.audienceRoles,
        audience_emails: payload.audienceEmails,
        pinned: payload.pinned,
        requires_ack: payload.requiresAck,
        sent_at: null,
        shared_with: [],
        suggestion_id: context.suggestion.id,
      })
      .select('id, title')
      .single();
    if (error) throw new Error(error.message);
    const message = data as Pick<AdminMessageRow, 'id' | 'title'>;
    return {
      resultType: 'admin_message',
      resultId: message.id,
      label: `${message.title} (draft)`,
      href: messageHref(message.id),
    };
  },
};
