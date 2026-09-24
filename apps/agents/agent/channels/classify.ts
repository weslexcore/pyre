// POST /pyre/classify — Jev classification for the integrations app. Not a
// session: the request carries one piece of staff-written text, Jev (TypeSafe
// AI's System One model, through AI Gateway) answers one yes/no question per
// signal type, and the probabilities come straight back in the response.
// No language model, no tools, no session history — and nothing here writes
// anywhere; the caller stores the result.
//
// The integrations app calls this from background work only (after a shift
// note is saved and its response has gone out), so latency here never
// reaches a person.
//
//   POST { subject, text } → 200 { model, probabilities: { action: 0.91, ... } }
//                            400 bad input · 401 bad secret · 502 Jev failed
//
// Auth: Bearer EVE_CHANNEL_SECRET, the same secret the session channel takes.

import { isSubjectType, MAX_CLASSIFY_TEXT, sanitizeClassifyText } from '@pyre/signals-core';
import { defineChannel, POST } from 'eve/channels';
import { routeAuth } from 'eve/channels/auth';
import { channelSecretAuth } from '../lib/channel-auth';
import { classifyText } from '../lib/classify/classify';

/** Jev answers in well under a second; this only bounds a stuck upstream. */
const JEV_TIMEOUT_MS = 20_000;

export default defineChannel({
  routes: [
    POST('/pyre/classify', async (request) => {
      const caller = await routeAuth(request, [channelSecretAuth()]);
      if (caller instanceof Response) return caller;

      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
      }
      if (!isSubjectType(body.subject)) {
        return Response.json({ error: 'Unknown subject' }, { status: 400 });
      }
      const raw = typeof body.text === 'string' ? body.text : '';
      if (raw.length > MAX_CLASSIFY_TEXT * 2 || !sanitizeClassifyText(raw)) {
        return Response.json(
          { error: `text must be 1–${MAX_CLASSIFY_TEXT} characters` },
          { status: 400 }
        );
      }

      try {
        const result = await classifyText(body.subject, raw, {
          abortSignal: AbortSignal.timeout(JEV_TIMEOUT_MS),
        });
        return Response.json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[classify] Jev failed:', message);
        return Response.json({ error: message }, { status: 502 });
      }
    }),
  ],
});
