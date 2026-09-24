// Save what the classifier found via the integrations app, which validates
// the signals against the same registry (@pyre/signals-core) and files them
// on the record the session was started for. The model never names that
// record: the request id comes from the session's auth (lib/role.ts), so a
// session can only ever write its own result. Server-side errors come back
// verbatim so the model can fix and resubmit.
//
// Exposed to the model only in classifier sessions — see agent/tools/role_tools.ts.

import { MAX_SIGNAL_SUMMARY, MAX_SIGNALS, SIGNAL_TYPES } from '@pyre/signals-core';
import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { postClassification } from '../api';
import { classifyRequestOf } from '../role';

export const saveClassificationTool = defineTool({
  description:
    'Save every signal found in the text as one list (empty when there is nothing to act on). Call exactly once; on an error, fix the list and call again.',
  inputSchema: z.object({
    signals: z
      .array(
        z.object({
          type: z.enum(SIGNAL_TYPES).describe('The signal type, from the list in your instructions.'),
          summary: z
            .string()
            .min(1)
            .max(MAX_SIGNAL_SUMMARY)
            .describe('One plain line: what needs doing, answering, changing, or knowing.'),
        })
      )
      .max(MAX_SIGNALS),
  }),
  async execute(input, ctx) {
    const requestId = classifyRequestOf(ctx.session?.auth);
    if (!requestId) {
      return { saved: false, error: 'This session has no classification request to save to.' };
    }
    const { status, body } = await postClassification({
      requestId,
      signals: input.signals,
      agentSessionId: ctx.session?.id ?? null,
    });
    // The text was edited (or deleted) while this session ran and a newer
    // request replaced this one: nothing to fix, and nothing to retry.
    if (status === 409) {
      return {
        saved: false,
        superseded: true,
        error: 'The text changed and a newer classification replaced this one. Stop; do not call again.',
      };
    }
    if (status >= 400) return { saved: false, status, error: body.error ?? 'Unknown error' };
    return { saved: true, ...body };
  },
});
