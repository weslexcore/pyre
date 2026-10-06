// Parses an SOP's markdown into an alternating sequence of prose chunks and
// task items, so the run UI can render real, stateful checkboxes (bound to
// sop_run_checks rows by item index) between the document's headings and
// notes. Task indexes are document order, 0-based — the same numbering the
// runs API validates against. Client-bundle-safe.

/**
 * Matches a GFM task line: `- [ ] text` (any marker, any check state) — plus
 * `- [!] text`, this library's own marker for a required item: one a run has
 * to check off and may never skip. `!` sits in the box rather than in the
 * text so the requirement never leaks into what gets recorded on the check.
 */
const TASK_RE = /^(\s*)[-*+]\s+\[([ xX!])\]\s+(.*\S)\s*$/;

/** The box marker that makes an item required. */
export const REQUIRED_MARKER = '!';

export interface ChecklistTask {
  /** 0-based position among the document's task items, in document order. */
  index: number;
  /** The task's inline markdown (may contain **bold**, links, etc.). */
  text: string;
  /** Nesting depth: 0 = top level, 1 = sub-task, ... */
  depth: number;
  /** Written `- [!]`: the item must be completed, and cannot be skipped. */
  required: boolean;
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
      text: match[3],
      // The seeds indent nested tasks by two spaces per level.
      depth: Math.min(Math.floor(match[1].length / 2), 3),
      required: match[2] === REQUIRED_MARKER,
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

/**
 * The task at `index` plus every task nested under it, in document order.
 * Checking a parent checks its whole subtree, so the UI needs the group; a
 * task with nothing nested returns just itself.
 */
export function subtreeTasks(tasks: ChecklistTask[], index: number): ChecklistTask[] {
  const start = tasks.findIndex((task) => task.index === index);
  if (start === -1) return [];
  const root = tasks[start];
  const group = [root];
  for (let i = start + 1; i < tasks.length && tasks[i].depth > root.depth; i++) {
    group.push(tasks[i]);
  }
  return group;
}

/**
 * Indexes of the items a run must complete — the `- [!]` ones — so callers
 * can refuse to record them as skipped. Read from the document the run
 * pinned, never the current text: an item marked required mid-run does not
 * retroactively invalidate a skip already on the record.
 */
export function requiredIndexes(content: string): Set<number> {
  const required = new Set<number>();
  for (const task of parseChecklist(content).tasks) {
    if (task.required) required.add(task.index);
  }
  return required;
}

/**
 * The entries of `items` that ask to skip an item `content` marks required.
 * Empty when the request is fine — nothing to skip, or nothing required.
 */
export function forbiddenSkips<T extends { itemIndex: number; skipped?: boolean }>(
  content: string,
  items: T[]
): T[] {
  if (!items.some((item) => item.skipped)) return [];
  const required = requiredIndexes(content);
  return items.filter((item) => item.skipped && required.has(item.itemIndex));
}

/**
 * One resolved item, however the caller stores it — a sop_run_checks row, an
 * entry in a board card's checklist answer. What the shared Checklist
 * component draws from.
 */
export interface ChecklistMark {
  /** The task's index (ChecklistTask.index). */
  index: number;
  /** Skipped rather than completed. */
  skipped: boolean;
  /** Who resolved it: an email, named through PeopleNames. */
  by: string;
  /** When, as an ISO timestamp. */
  at: string;
}

/**
 * Whether a checklist has reached the end: it has items, every one is
 * resolved, and every required one is resolved by completing it. A skipped
 * required item (one marked required after the skip was recorded) holds the
 * checklist open, the same as an untouched one.
 */
export function isChecklistComplete(
  tasks: Pick<ChecklistTask, 'index' | 'required'>[],
  marks: Pick<ChecklistMark, 'index' | 'skipped'>[]
): boolean {
  if (tasks.length === 0) return false;
  const byIndex = new Map(marks.map((mark) => [mark.index, mark]));
  return tasks.every((task) => {
    const mark = byIndex.get(task.index);
    return mark !== undefined && !(task.required && mark.skipped);
  });
}

/**
 * Whether an item still needs doing: nothing recorded against it, or it is
 * required and was skipped (which holds the checklist open all the same).
 */
export function isOutstanding(
  task: Pick<ChecklistTask, 'required'>,
  mark: Pick<ChecklistMark, 'skipped'> | undefined
): boolean {
  return mark === undefined || (task.required && mark.skipped);
}

const HEADING_RE = /^#{1,6}\s/;

/**
 * The segments to draw when a checklist is filtered down to what is still
 * outstanding. Every outstanding item stays, along with the items it is
 * nested under (so a sub-task keeps its context, drawn resolved as it is).
 * Prose drops out except its headings, and a heading only stays when an item
 * under it does — the filtered list reads as "what's left, by section".
 */
export function outstandingSegments(
  parsed: ParsedChecklist,
  marks: Pick<ChecklistMark, 'index' | 'skipped'>[]
): ChecklistSegment[] {
  const byIndex = new Map(marks.map((mark) => [mark.index, mark]));
  const keep = new Set<number>();
  // The chain of items above the current one, by depth.
  const ancestors: ChecklistTask[] = [];
  for (const task of parsed.tasks) {
    while (ancestors.length > 0 && ancestors[ancestors.length - 1].depth >= task.depth) {
      ancestors.pop();
    }
    if (isOutstanding(task, byIndex.get(task.index))) {
      keep.add(task.index);
      for (const ancestor of ancestors) keep.add(ancestor.index);
    }
    ancestors.push(task);
  }

  const out: ChecklistSegment[] = [];
  // The latest headings seen, held back until an item under them is kept.
  let pendingHeadings: ChecklistSegment | null = null;
  for (const segment of parsed.segments) {
    if (segment.kind === 'markdown') {
      const headings = segment.content.split('\n').filter((line) => HEADING_RE.test(line));
      if (headings.length > 0) {
        pendingHeadings = { kind: 'markdown', content: headings.join('\n\n'), line: segment.line };
      }
      continue;
    }
    if (!keep.has(segment.task.index)) continue;
    if (pendingHeadings) {
      out.push(pendingHeadings);
      pendingHeadings = null;
    }
    out.push(segment);
  }
  return out;
}
