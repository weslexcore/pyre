// The model's tool set, resolved per session from its role (lib/role.ts):
// scheduler sessions get the drafting tools, knowledge sessions get the
// read-only knowledge-base tools, and neither sees the other's. Keeping both
// sets dynamic (rather than authoring the scheduler's statically) is what
// keeps save_proposal — the one write path in this app — out of reach of a
// staff member's question.
//
// Each execute re-derives the scope from the session's auth rather than
// closing over it, so the tools behave the same on replay as on the first
// step. Every entry is wrapped in defineTool with an inline execute, as the
// dynamic-tools contract requires.

import { defineDynamic, defineTool } from 'eve/tools';
import { z } from 'zod';
import { getShiftNotes, getWaterLog, readIncident } from '../lib/knowledge/logs';
import { getShifts } from '../lib/knowledge/schedule';
import { KNOWLEDGE_SOURCES, searchKnowledge } from '../lib/knowledge/search';
import { readSop, sopTableOfContents } from '../lib/knowledge/sops';
import { type KnowledgeScope, resolveRole } from '../lib/role';
import { getWeekContextTool } from '../lib/scheduler/get-week-context';
import { saveProposalTool } from '../lib/scheduler/save-proposal';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

function scopeOf(ctx: { session?: { auth?: Parameters<typeof resolveRole>[0] } }): KnowledgeScope {
  const { role, scope } = resolveRole(ctx.session?.auth);
  if (role !== 'knowledge') {
    throw new Error('Knowledge tools are only available in knowledge sessions.');
  }
  return scope;
}

function schedulerTools() {
  return {
    get_week_context: defineTool({
      description: getWeekContextTool.description,
      inputSchema: getWeekContextTool.inputSchema,
      execute(input, ctx) {
        return getWeekContextTool.execute(input, ctx);
      },
    }),
    save_proposal: defineTool({
      description: saveProposalTool.description,
      inputSchema: saveProposalTool.inputSchema,
      execute(input, ctx) {
        return saveProposalTool.execute(input, ctx);
      },
    }),
  };
}

function knowledgeTools() {
  return {
    search_knowledge_base: defineTool({
      description:
        'Ranked full-text search across the staff knowledge base: the SOP library (procedures, policies, health and science guide, customer FAQ, tutorials), shift notes, incident report narratives, and cold tub water log notes — limited to what the asking staff member may read. Returns snippets with [[matched words]] and a dashboard url per hit (SOP hits carry a #section anchor). Call this first for every question; search again with other wording when results are thin.',
      inputSchema: z.object({
        query: z
          .string()
          .min(2)
          .max(200)
          .describe(
            'Key terms of the question, websearch syntax: plain words must all match, "quoted phrases" match exactly, OR between alternatives, -word excludes.'
          ),
        sources: z
          .array(z.enum(KNOWLEDGE_SOURCES))
          .optional()
          .describe('Restrict to some sources; defaults to all the staff member may read.'),
        limit: z.number().int().min(1).max(20).optional().describe('Max hits (default 8).'),
      }),
      execute(input, ctx) {
        return searchKnowledge(scopeOf(ctx), input);
      },
    }),
    list_sops: defineTool({
      description:
        'The SOP library as a table of contents — every document the staff member may read, with category, slug, last-updated date, url, and section headings with anchors. Use it to browse when search misses, or to find the right document for a broad question.',
      inputSchema: z.object({}),
      execute(_input, ctx) {
        return sopTableOfContents(scopeOf(ctx));
      },
    }),
    read_sop: defineTool({
      description:
        'Read one SOP by slug: the full markdown, or a single section (by anchor or heading text) with its subsections. Returns the document url (anchored when a section was requested) to cite. Read before quoting a procedure, number, or health claim.',
      inputSchema: z.object({
        slug: z.string().min(1).max(120).describe('The document slug from search or list_sops.'),
        section: z
          .string()
          .max(200)
          .optional()
          .describe('A section anchor (e.g. "quick-reference") or heading text; omit for the whole document.'),
      }),
      execute(input, ctx) {
        return readSop(scopeOf(ctx), input.slug, input.section);
      },
    }),
    get_water_log: defineTool({
      description:
        'Recent entries from the cold tub water log (/admin/water): test readings (TA, pH, chlorine, salt), shock and refill entries, chemical doses, and notes, newest first. For questions like "when was the left tub last shocked" or "what was the chlorine yesterday". Available only when the staff member holds the water log page.',
      inputSchema: z.object({
        tub: z.enum(['left', 'right']).optional().describe('One tub; omit for both.'),
        days: z.number().int().min(1).max(365).optional().describe('Look-back window (default 30).'),
        limit: z.number().int().min(1).max(100).optional().describe('Max entries (default 20).'),
      }),
      execute(input, ctx) {
        return getWaterLog(scopeOf(ctx), input);
      },
    }),
    get_shift_notes: defineTool({
      description:
        'Shift notes (/admin/shift-notes) in a date window, newest shift first: how shifts went, handoffs, and feedback. Admins read everyone\'s notes; everyone else reads only their own.',
      inputSchema: z.object({
        from: dateString.optional().describe('Earliest shift date, inclusive.'),
        to: dateString.optional().describe('Latest shift date, inclusive.'),
        limit: z.number().int().min(1).max(100).optional().describe('Max notes (default 20).'),
      }),
      execute(input, ctx) {
        return getShiftNotes(scopeOf(ctx), input);
      },
    }),
    get_shifts: defineTool({
      description:
        'The staff schedule (/admin/schedule) for a date window: shifts with date, times, and the crew on each (names, roles, hours), plus the asking staff member\'s own hours by week, their pending shift requests, and open sub requests anyone may claim. Default is their own shifts over the next four weeks; pass an earlier window for past shifts ("how many hours did I work last week"), and who: "everyone" for the whole board ("who is on Saturday", "are there open shifts"). Times are Eastern. Available only when the staff member holds the Schedule page.',
      inputSchema: z.object({
        from: dateString.optional().describe('Earliest shift date, inclusive (default today).'),
        to: dateString
          .optional()
          .describe('Latest shift date, inclusive (default four weeks after from; at most a year).'),
        who: z
          .enum(['me', 'everyone'])
          .optional()
          .describe('"me" (default): only shifts the staff member is on. "everyone": every shift in the window.'),
        limit: z.number().int().min(1).max(200).optional().describe('Max shifts (default 50).'),
      }),
      execute(input, ctx) {
        return getShifts(scopeOf(ctx), input);
      },
    }),
    read_incident: defineTool({
      description:
        'One incident report by reference (INC-YYYY-NNNN): what happened, the response, conditions, follow-up, and resolution. Never includes the people involved or their contact details. Available for reports the staff member may read (all with incidents:manage, otherwise only ones they filed).',
      inputSchema: z.object({
        reference: z.string().regex(/^INC-\d{4}-\d{4}$/i, 'INC-YYYY-NNNN'),
      }),
      execute(input, ctx) {
        return readIncident(scopeOf(ctx), input.reference);
      },
    }),
  };
}

function toolsFor(auth: Parameters<typeof resolveRole>[0]) {
  return resolveRole(auth).role === 'knowledge' ? knowledgeTools() : schedulerTools();
}

export default defineDynamic({
  events: {
    'session.started': (_event, ctx) => toolsFor(ctx.session.auth),
    'turn.started': (_event, ctx) => toolsFor(ctx.session.auth),
  },
});
