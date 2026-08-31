// Save the drafted week as a proposal batch via the integrations app (the
// single validated write path). Server-side errors — including the hard
// time-off conflict report — come back verbatim so the model can fix and
// resubmit. AGENT_FORCE_DRY_RUN=1 (evals) validates without writing.

import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { postProposal } from '../lib/api';

const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export default defineTool({
  description:
    'Save the drafted schedule for one week as a proposal for admin review. Call exactly once per drafting or refinement turn, after get_week_context; a save supersedes your previous draft for the week. Assignments reference existing shifts by shiftId, or new shifts (in this payload) by shiftKey. On validation/conflict errors, fix the draft and call again.',
  inputSchema: z.object({
    weekStart: dateString.describe('Monday of the drafted week'),
    rationale: z
      .string()
      .max(8000)
      .describe('Short markdown for the admin: one bullet per day + a Tradeoffs section'),
    summary: z
      .object({
        uncoveredShifts: z.number().int().min(0).default(0),
        partialAvailabilityPlacements: z.number().int().min(0).default(0),
        warnings: z.array(z.string()).default([]),
      })
      .describe('Machine-readable counts and warnings shown as badges'),
    shifts: z
      .array(
        z.object({
          key: z.string().min(1).describe('Payload-local key assignments can reference'),
          shiftDate: dateString,
          label: z.string().min(1).max(40),
          startsAt: timeString,
          endsAt: timeString,
          staffNeeded: z.number().int().min(0).max(20),
          notes: z.string().max(500).nullish(),
        })
      )
      .default([])
      .describe('Extra shifts beyond the synced coverage windows (usually empty)'),
    assignments: z
      .array(
        z.object({
          shiftId: z.string().nullish().describe('Existing shift id (from get_week_context)'),
          shiftKey: z.string().nullish().describe("A new shift's key from this payload"),
          staffId: z.string().min(1),
          startsAt: timeString.nullish().describe('Defaults to the shift window'),
          endsAt: timeString.nullish(),
          role: z.enum(['full', 'setup', 'partial']).default('full'),
          notes: z.string().max(500).nullish(),
        })
      )
      .min(1),
  }),
  async execute(input, ctx) {
    const { status, body } = await postProposal({
      ...input,
      source: 'manual',
      agentSessionId: ctx.session?.id ?? null,
      dryRun: process.env.AGENT_FORCE_DRY_RUN === '1',
    });

    if (status >= 400) {
      return {
        saved: false,
        status,
        error: body.error ?? 'Unknown error',
        conflicts: body.conflicts ?? [],
      };
    }
    return { saved: true, ...body };
  },
});
