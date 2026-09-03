// The assistant's trail for one question: what it said to itself between
// tool calls and each tool it called, with the call's input and result. The
// Ask island builds it live from the reduced event stream (stream.ts) and
// keeps it beside the answer so a reader can open any step; the agent
// writes the same shape to knowledge_queries.trail so a reopened
// conversation shows it too (apps/agents/agent/lib/knowledge/audit.ts).
// Client-bundle-safe: types and pure helpers only.

/** One step of the trail, in the order it happened. */
export type TrailStep =
  /** Narration the assistant wrote before calling a tool ("Let me check the water log…"). */
  | { kind: 'thought'; text: string }
  /** One tool call, from request through result. */
  | {
      kind: 'tool';
      callId: string;
      tool: string;
      input: Record<string, unknown>;
      status: 'running' | 'completed' | 'failed';
      /** The tool's output, serialised and capped; absent while running. */
      output?: string;
      /** Failure detail when status is 'failed'. */
      error?: string;
    };

export type TrailToolStep = Extract<TrailStep, { kind: 'tool' }>;

/** Tool outputs longer than this are cut for the trail; the model still saw the whole thing. */
export const TRAIL_OUTPUT_MAX_LENGTH = 6000;

/** What each knowledge tool is doing, as the trail names it. */
export const TOOL_LABELS: Record<string, string> = {
  search_knowledge_base: 'Searched',
  list_sops: 'Browsed the library',
  read_sop: 'Read',
  get_water_log: 'Read the water log',
  get_shift_notes: 'Read shift notes',
  read_incident: 'Read incident',
  get_shifts: 'Read the schedule',
};

/** The same tools, present tense, for the line shown while one runs. */
export const TOOL_ACTIVITY_LABELS: Record<string, string> = {
  search_knowledge_base: 'Searching the knowledge base',
  list_sops: 'Browsing the library',
  read_sop: 'Reading a document',
  get_water_log: 'Reading the water log',
  get_shift_notes: 'Reading shift notes',
  read_incident: 'Reading an incident report',
  get_shifts: 'Reading the schedule',
};

/** A tool's output as one string for the trail, cut to the cap with a marker. */
export function serializeToolOutput(output: unknown): string {
  const text =
    typeof output === 'string'
      ? output
      : output === undefined
        ? ''
        : (() => {
            try {
              return JSON.stringify(output, null, 2) ?? '';
            } catch {
              return String(output);
            }
          })();
  return text.length > TRAIL_OUTPUT_MAX_LENGTH
    ? `${text.slice(0, TRAIL_OUTPUT_MAX_LENGTH)}\n… (cut, ${text.length - TRAIL_OUTPUT_MAX_LENGTH} more characters)`
    : text;
}

/** A tool call as one readable line: what it did and the key argument. */
export function describeToolCall(call: { tool: string; input: Record<string, unknown> }): string {
  const label = TOOL_LABELS[call.tool] ?? call.tool;
  const { input } = call;
  const arg =
    typeof input.query === 'string'
      ? `"${input.query}"`
      : typeof input.slug === 'string'
        ? `${input.slug}${typeof input.section === 'string' ? `#${input.section}` : ''}`
        : typeof input.reference === 'string'
          ? input.reference
          : Object.keys(input).length > 0
            ? JSON.stringify(input)
            : '';
  return arg ? `${label} ${arg}` : label;
}

/** The parsed output of a step, when it was JSON. */
function parsedOutput(step: TrailToolStep): Record<string, unknown> | null {
  if (!step.output) return null;
  try {
    const value = JSON.parse(step.output) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * A few words on how a tool call went, for its row in the trail: hit
 * counts for searches, the document title for reads, the error otherwise.
 */
export function summarizeToolResult(step: TrailToolStep): string {
  if (step.status === 'running') return 'running';
  if (step.status === 'failed') return step.error ? `failed: ${step.error}` : 'failed';
  const out = parsedOutput(step);
  if (!out) return step.output ? 'done' : 'no output';
  if (typeof out.error === 'string' && out.error) return out.error;
  switch (step.tool) {
    case 'search_knowledge_base': {
      const count = typeof out.count === 'number' ? out.count : null;
      return count === null ? 'done' : count === 1 ? '1 hit' : `${count} hits`;
    }
    case 'list_sops': {
      const count = typeof out.count === 'number' ? out.count : null;
      return count === null ? 'done' : `${count} document${count === 1 ? '' : 's'}`;
    }
    case 'read_sop': {
      const title = typeof out.title === 'string' ? out.title : null;
      const section =
        out.section && typeof out.section === 'object'
          ? (out.section as { heading?: unknown }).heading
          : null;
      if (!title) return 'done';
      return typeof section === 'string' ? `${title} › ${section}` : title;
    }
    case 'read_incident':
      return typeof out.reference === 'string' ? out.reference : 'done';
    case 'get_shifts': {
      const count = typeof out.count === 'number' ? out.count : null;
      const window = out.window as { from?: unknown; to?: unknown } | undefined;
      const range =
        window && typeof window.from === 'string' && typeof window.to === 'string'
          ? ` ${window.from} to ${window.to}`
          : '';
      return count === null ? 'done' : `${count} shift${count === 1 ? '' : 's'}${range}`;
    }
    default: {
      const rows = Array.isArray(out.entries)
        ? out.entries.length
        : Array.isArray(out.notes)
          ? out.notes.length
          : Array.isArray(out.rows)
            ? out.rows.length
            : typeof out.count === 'number'
              ? out.count
              : null;
      return rows === null ? 'done' : `${rows} ${rows === 1 ? 'entry' : 'entries'}`;
    }
  }
}

/** One line for the trail header: the distinct things it did, in order. */
export function summarizeTrail(steps: TrailStep[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const step of steps) {
    if (step.kind !== 'tool') continue;
    const label = TOOL_LABELS[step.tool] ?? step.tool;
    if (seen.has(label)) continue;
    seen.add(label);
    parts.push(label);
  }
  const toolCount = steps.filter((s) => s.kind === 'tool').length;
  if (toolCount === 0) return 'Answered without looking anything up';
  return `${parts.join(' · ')} — ${toolCount} ${toolCount === 1 ? 'lookup' : 'lookups'}`;
}

/** Is this a trail step as the audit log or the stream would produce it? */
export function isTrailStep(value: unknown): value is TrailStep {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.kind === 'thought') return typeof v.text === 'string';
  if (v.kind === 'tool') {
    return (
      typeof v.callId === 'string' &&
      typeof v.tool === 'string' &&
      !!v.input &&
      typeof v.input === 'object' &&
      (v.status === 'running' || v.status === 'completed' || v.status === 'failed')
    );
  }
  return false;
}

/** The trail column of a log row, tolerant of anything that is not a well-formed step. */
export function trailFromJson(value: unknown): TrailStep[] {
  return Array.isArray(value) ? value.filter(isTrailStep) : [];
}

/** Append a tool call to the trail (or, when its call id is already there, leave it alone). */
export function trailWithCalls(
  steps: TrailStep[],
  calls: Array<{ callId: string; tool: string; input: Record<string, unknown> }>
): TrailStep[] {
  const known = new Set(steps.map((s) => (s.kind === 'tool' ? s.callId : '')));
  const added = calls
    .filter((c) => !known.has(c.callId))
    .map<TrailStep>((c) => ({ kind: 'tool', ...c, status: 'running' }));
  return added.length > 0 ? [...steps, ...added] : steps;
}

/** Record a tool call's result on its step. A result for an unknown call is dropped. */
export function trailWithResult(
  steps: TrailStep[],
  result: { callId: string; status: 'completed' | 'failed'; output?: string; error?: string }
): TrailStep[] {
  return steps.map((s) =>
    s.kind === 'tool' && s.callId === result.callId
      ? {
          ...s,
          status: result.status,
          ...(result.output !== undefined ? { output: result.output } : {}),
          ...(result.error ? { error: result.error } : {}),
        }
      : s
  );
}

/** Append narration, skipping blanks. */
export function trailWithThought(steps: TrailStep[], text: string): TrailStep[] {
  const trimmed = text.trim();
  return trimmed ? [...steps, { kind: 'thought', text: trimmed }] : steps;
}
