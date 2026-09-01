import { describe, expect, it } from 'vitest';
import { countTasks, parseChecklist, subtreeTasks } from './checklist';

const DOC = `## Large Sauna

- [ ] Uncover wood
- [ ] **Ensure fire is out!**
  - [ ] Remove chimney
  - [x] Cover chimney hole

> Ongoing: add wood throughout.

## Plunges

- [ ] Re-cover plunges
`;

describe('parseChecklist', () => {
  it('numbers tasks in document order and keeps their inline markdown', () => {
    const { tasks } = parseChecklist(DOC);
    expect(tasks.map((t) => t.text)).toEqual([
      'Uncover wood',
      '**Ensure fire is out!**',
      'Remove chimney',
      'Cover chimney hole',
      'Re-cover plunges',
    ]);
    expect(tasks.map((t) => t.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it('records nesting depth from indentation', () => {
    const { tasks } = parseChecklist(DOC);
    expect(tasks.map((t) => t.depth)).toEqual([0, 0, 1, 1, 0]);
  });

  it('collapses consecutive prose lines into single markdown segments', () => {
    const { segments } = parseChecklist(DOC);
    const kinds = segments.map((s) => s.kind);
    expect(kinds).toEqual([
      'markdown', // heading
      'task',
      'task',
      'task',
      'task',
      'markdown', // blockquote + second heading
      'task',
    ]);
    const middle = segments[5];
    if (middle.kind !== 'markdown') throw new Error('expected markdown segment');
    expect(middle.content).toContain('Ongoing');
    expect(middle.content).toContain('## Plunges');
  });

  it('treats a document without tasks as pure prose', () => {
    const { segments, tasks } = parseChecklist('# Philosophy\n\nJust words.');
    expect(tasks).toHaveLength(0);
    expect(segments).toHaveLength(1);
  });
});

describe('countTasks', () => {
  it('counts tasks and returns 0 for prose documents', () => {
    expect(countTasks(DOC)).toBe(5);
    expect(countTasks('no tasks here')).toBe(0);
  });
});

describe('subtreeTasks', () => {
  const { tasks } = parseChecklist(DOC);

  it('returns a parent with everything nested under it', () => {
    expect(subtreeTasks(tasks, 1).map((t) => t.text)).toEqual([
      '**Ensure fire is out!**',
      'Remove chimney',
      'Cover chimney hole',
    ]);
  });

  it('returns a leaf alone', () => {
    expect(subtreeTasks(tasks, 0).map((t) => t.index)).toEqual([0]);
    expect(subtreeTasks(tasks, 2).map((t) => t.index)).toEqual([2]);
    expect(subtreeTasks(tasks, 4).map((t) => t.index)).toEqual([4]);
  });

  it('returns nothing for an unknown index', () => {
    expect(subtreeTasks(tasks, 99)).toEqual([]);
  });
});
