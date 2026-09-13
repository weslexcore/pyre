// Static-markup render of the live checklist: task rows as real checkboxes
// bound to run checks, a Skip control beside each open item, quiet
// attribution under resolved items (skips say so), and the sticky progress
// header — with Discard but no Finish — that only exists while a run is open.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SopRunCheckRow, SopRunRow } from '@/lib/db';
import { ChecklistConfirmDialog, ChecklistView } from './ChecklistView';

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
  skipped: false,
};

const SKIP: SopRunCheckRow = {
  ...CHECK,
  id: 'check-2',
  item_index: 1,
  item_text: 'Ensure fire is out',
  checked_by: 'bob@pyresauna.com',
  checked_at: '2026-09-01T14:06:00Z',
  skipped: true,
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
      onDiscard={noop}
      {...props}
    />
  );
}

describe('ChecklistView', () => {
  it('renders prose, one real checkbox and a Skip per task, no header without a run', () => {
    const html = render();
    expect(html).toContain('Large Sauna');
    expect(html.match(/type="checkbox"/g)?.length).toBe(3);
    expect(html.match(/>Skip</g)?.length).toBe(3);
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
    // A completed item has no side control — its box un-resolves it.
    expect(html.match(/>Skip</g)?.length).toBe(2);
    expect(html).not.toContain('>Undo<');
  });

  it('renders a skipped item as resolved-but-not-done, with Undo and who skipped it', () => {
    const html = render({
      run: RUN,
      checks: [SKIP],
      people: { 'bob@pyresauna.com': 'Bob' },
    });
    // The box reads as resolved, drawn dashed with a dash rather than a tick.
    expect(html.match(/checked=""/g)?.length).toBe(1);
    expect(html).toContain('border-dashed');
    expect(html).toContain('M2.5 6h7');
    expect(html).not.toContain('line-through');
    expect(html).toContain('skipped by Bob ·');
    expect(html.match(/>Undo</g)?.length).toBe(1);
    expect(html.match(/>Skip</g)?.length).toBe(2);
  });

  it('shows the progress header with counts and Discard, never Finish, while a run is open', () => {
    const html = render({ run: RUN, checks: [CHECK] });
    expect(html).toContain('Checklist in progress');
    expect(html).toContain('1 of 3');
    expect(html).not.toContain('>Finish<');
    expect(html).toContain('>Discard<');
    expect(html).toContain('width:33%');
    expect(html).toContain('finishes on its own');
  });

  it('counts skips in the header alongside progress', () => {
    const html = render({ run: RUN, checks: [CHECK, SKIP] });
    expect(html).toContain('2 of 3');
    expect(html).toContain('· 1 skipped');
    expect(html).toContain('width:67%');
  });

  it('switches to the done state once every item is checked or skipped', () => {
    const checks = [
      CHECK,
      SKIP,
      { ...CHECK, id: 'check-3', item_index: 2, item_text: 'Remove chimney' },
    ];
    const html = render({ run: RUN, checks });
    expect(html).toContain('All items done');
    expect(html).not.toContain('Checklist in progress');
    expect(html).not.toContain('finishes on its own');
    expect(html).toContain('width:100%');
  });

  it('shows a finished run ticked and locked, with Start again', () => {
    const checks = [
      CHECK,
      SKIP,
      { ...CHECK, id: 'check-3', item_index: 2, item_text: 'Remove chimney' },
    ];
    const html = render({
      run: {
        ...RUN,
        status: 'completed',
        ended_by: 'marina@pyresauna.com',
        ended_at: '2026-09-01T14:20:00Z',
      },
      checks,
      people: { 'marina@pyresauna.com': 'Marina' },
    });
    expect(html).toContain('>Completed<');
    expect(html).toContain('finished by Marina');
    expect(html).toContain('>Start again<');
    expect(html).not.toContain('>Finish<');
    expect(html).not.toContain('>Discard<');
    expect(html.match(/disabled=""/g)?.length).toBe(3);
    expect(html.match(/checked=""/g)?.length).toBe(3);
    // Locked rows take no taps: no Skip or Undo either.
    expect(html).not.toContain('>Skip<');
    expect(html).not.toContain('>Undo<');
    expect(html).toContain('3 of 3');
    expect(html).toContain('· 1 skipped');
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

  it('pins the progress header under the nav by default, at the top in a modal', () => {
    expect(render({ run: RUN, checks: [CHECK] })).toContain('sticky top-14');
    const modal = render({ run: RUN, checks: [CHECK], headerOffset: 'none' });
    expect(modal).toContain('sticky top-0');
    expect(modal).not.toContain('top-14');
  });

  it('shows a progress bar under items that link to a sub-checklist', () => {
    const content = [
      '- [ ] [Clear towel hampers](/admin/sops/momence-dirty-towels)',
      '- [ ] [Break down](/admin/sops/break-down)',
      '- [ ] [Reset plunges](/admin/sops/reset-plunges)',
      '- [ ] Wipe the glass',
    ].join('\n');
    const html = render({
      content,
      linked: {
        'momence-dirty-towels': {
          slug: 'momence-dirty-towels',
          sopId: 'sop-2',
          taskCount: 5,
          checked: 2,
          status: 'in_progress',
        },
        'break-down': {
          slug: 'break-down',
          sopId: 'sop-3',
          taskCount: 4,
          checked: 4,
          status: 'completed',
        },
        'reset-plunges': {
          slug: 'reset-plunges',
          sopId: 'sop-4',
          taskCount: 3,
          checked: 0,
          status: 'none',
        },
      },
    });
    expect(html).toContain('2 of 5');
    expect(html).toContain('width:40%');
    expect(html).toContain('Completed');
    expect(html).toContain('Not started');
    // Three bars for three linked items; the plain item gets none.
    expect(html.match(/h-1\.5 w-32/g)?.length).toBe(3);
  });

  it('renders no bar when the linked document is unknown', () => {
    const html = render({
      content: '- [ ] [Clear towel hampers](/admin/sops/momence-dirty-towels)',
      linked: {},
    });
    expect(html).not.toContain('w-32');
    expect(html).not.toContain('Not started');
  });
});

describe('ChecklistConfirmDialog', () => {
  it('counts what a discard would erase, skips included', () => {
    const discard = renderToStaticMarkup(
      <ChecklistConfirmDialog
        runData={{ run: RUN, checks: [CHECK, SKIP], content: CONTENT }}
        busy={false}
        onConfirm={noop}
        onCancel={noop}
      />
    );
    expect(discard).toContain('Discard checklist?');
    expect(discard).toContain('2 items already checked off or skipped');
  });
});
