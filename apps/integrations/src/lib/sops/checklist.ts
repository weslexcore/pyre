// Parses an SOP's markdown into an alternating sequence of prose chunks and
// task items, so the run UI can render real, stateful checkboxes (bound to
// sop_run_checks rows by item index) between the document's headings and
// notes. Task indexes are document order, 0-based — the same numbering the
// runs API validates against. Client-bundle-safe.

/** Matches a GFM task line: `- [ ] text` (any marker, any check state). */
const TASK_RE = /^(\s*)[-*+]\s+\[[ xX]\]\s+(.*\S)\s*$/;

export interface ChecklistTask {
  /** 0-based position among the document's task items, in document order. */
  index: number;
  /** The task's inline markdown (may contain **bold**, links, etc.). */
  text: string;
  /** Nesting depth: 0 = top level, 1 = sub-task, ... */
  depth: number;
}

export type ChecklistSegment =
  | { kind: 'markdown'; content: string; line: number }
  | { kind: 'task'; task: ChecklistTask; line: number };

export interface ParsedChecklist {
  segments: ChecklistSegment[];
  tasks: ChecklistTask[];
}

/**
 * Split `content` into prose segments and task items. Consecutive non-task
 * lines collapse into one markdown segment; each task line becomes its own
 * segment. (Fenced code blocks aren't special-cased — no SOP uses a task-like
 * line inside one, and the cost of a false positive is one odd checkbox.)
 */
export function parseChecklist(content: string): ParsedChecklist {
  const segments: ChecklistSegment[] = [];
  const tasks: ChecklistTask[] = [];
  let proseBuffer: string[] = [];
  // Source line the current prose buffer started on — segments carry their
  // line number as a stable render key (identical prose chunks repeat in the
  // seeded checklists).
  let proseStart = 0;

  const flushProse = () => {
    const chunk = proseBuffer.join('\n');
    if (chunk.trim()) segments.push({ kind: 'markdown', content: chunk, line: proseStart });
    proseBuffer = [];
  };

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(TASK_RE);
    if (!match) {
      if (proseBuffer.length === 0) proseStart = i;
      proseBuffer.push(line);
      continue;
    }
    flushProse();
    const task: ChecklistTask = {
      index: tasks.length,
      text: match[2],
      // The seeds indent nested tasks by two spaces per level.
      depth: Math.min(Math.floor(match[1].length / 2), 3),
    };
    tasks.push(task);
    segments.push({ kind: 'task', task, line: i });
  }
  flushProse();

  return { segments, tasks };
}

/** Number of task items in a document (0 = not a runnable checklist). */
export function countTasks(content: string): number {
  return parseChecklist(content).tasks.length;
}
