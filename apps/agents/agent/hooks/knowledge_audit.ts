// Records the question of each knowledge turn in the audit log. Hooks see
// the inbound message but not the session's auth, so this one only fills
// in the question on a row the channel handler created for a knowledge
// session (agent/channels/eve.ts); scheduler turns have no row and the
// update matches nothing. Never throws — a thrown hook fails the turn.

import { defineHook } from 'eve/hooks';
import { auditQuestion } from '../lib/knowledge/audit';

export default defineHook({
  events: {
    async 'message.received'(event, ctx) {
      try {
        await auditQuestion(ctx.session.id, event.data.turnId, event.data.message);
      } catch (error) {
        console.warn('[knowledge-audit] hook failed:', error);
      }
    },
  },
});
