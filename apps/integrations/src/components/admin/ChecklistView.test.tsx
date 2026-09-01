// Static-markup render of the live checklist: task rows as real checkboxes
// bound to run checks, quiet attribution under checked items, and the sticky
// progress header that only exists while a run is open.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SopRunCheckRow, SopRunRow } from '@/lib/db';
import { ChecklistView } from './ChecklistView';

const CONTENT = `## Large Sauna

- [ ] Uncover wood
- [ ] Ensure fire is out
  - [ ] Remove chimney
`;

const RUN: SopRunRow = {
  id: 'run-1',
  sop_id: 'sop-1',
  sop_version: 3,
  task_count: 3,
  status: 'in_progress',
  started_by: 'marina@pyresauna.com',
  started_at: '2026-09-01T14:00:00Z',
  ended_by: null,
  ended_at: null,
  created_at: '2026-09-01T14:00:00Z',
  updated_at: '2026-09-01T14:00:00Z',
};

const CHECK: SopRunCheckRow = {
  id: 'check-1',
  run_id: 'run-1',
  item_index: 0,
  item_text: 'Uncover wood',
  checked_by: 'marina@pyresauna.com',
  checked_at: '2026-09-01T14:05:00Z',
};

const noop = () => {};

function render(props: Partial<Parameters<typeof ChecklistView>[0]> = {}) {
  return renderToStaticMarkup(
    <ChecklistView
      content={CONTENT}
      run={null}
      checks={[]}
      currentVersion={3}
      busy={false}
      onSopLink={noop}
      onToggle={noop}
      onFinish={noop}
      onDiscard={noop}
      {...props}
    />
  );
}

describe('ChecklistView', () => {
  it('renders prose and one real checkbox per task, no header without a run', () => {
    const html = render();
    expect(html).toContain('Large Sauna');
    expect(html.match(/type="checkbox"/g)?.length).toBe(3);
    expect(html).not.toContain('Checklist in progress');
    expect(html).not.toContain('>Finish<');
    expect(html).not.toContain('checked=""');
  });

  it('marks checked items and attributes them quietly', () => {
    const html = render({
      run: RUN,
      checks: [CHECK],
      people: { 'marina@pyresauna.com': 'Marina' },
    });
    expect(html.match(/checked=""/g)?.length).toBe(1);
    expect(html).toContain('line-through');
    // Attribution names the person, no sage check prefix any more.
    expect(html).toContain('Marina ·');
    expect(html).not.toContain('✓');
  });

  it('shows the progress header with counts while a run is open', () => {
    const html = render({ run: RUN, checks: [CHECK] });
    expect(html).toContain('Checklist in progress');
    expect(html).toContain('1 of 3');
    expect(html).toContain('>Finish<');
    expect(html).toContain('>Discard<');
    expect(html).toContain('width:33%');
  });

  it('switches to the done state when every item is checked', () => {
    const checks = [
      CHECK,
      { ...CHECK, id: 'check-2', item_index: 1, item_text: 'Ensure fire is out' },
      { ...CHECK, id: 'check-3', item_index: 2, item_text: 'Remove chimney' },
    ];
    const html = render({ run: RUN, checks });
    expect(html).toContain('All items done');
    expect(html).not.toContain('Checklist in progress');
    expect(html).toContain('width:100%');
  });

  it('notes the pinned version when the document has moved on', () => {
    const html = render({ run: RUN, checks: [CHECK], currentVersion: 5 });
    expect(html).toContain('Showing v3');
  });

  it('indents nested tasks', () => {
    const html = render();
    expect(html).toContain('pl-7');
  });

  it('restores breathing room above section headers between task groups', () => {
    const html = render({
      content: '## Sauna\n\n- [ ] Wipe glass\n\n## Plunges\n\n- [ ] Re-cover plunges\n',
    });
    // Both heading segments get the padding class; the first one cancels it.
    expect(html.match(/pt-8 first:pt-0/g)?.length).toBe(2);
  });
});
