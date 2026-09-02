// Static-markup render of the peek modal's checklist body: a peeked document
// with tasks is a live checklist (real, enabled checkboxes bound to its run,
// the progress header pinned to the modal's own top), not read-only prose.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SopRow, SopRunCheckRow, SopRunRow } from '@/lib/db';
import type { SopDocumentPayload } from '@/lib/sops/document';
import { isChecklistPayload, PeekChecklist, SopPeekModal } from './SopPeekModal';

const SOP: SopRow = {
  id: 'sop-2',
  slug: 'momence-dirty-towels',
  title: 'Clear towel hampers',
  category: 'Tutorials',
  content_md: '## Hampers\n\n- [ ] Empty the bins\n- [ ] Bag the towels\n- [ ] Restock\n',
  current_version: 2,
  sort_order: 0,
  archived: false,
  view_roles: ['staff'],
  view_emails: [],
  edit_roles: ['admin'],
  edit_emails: [],
  created_by: null,
  updated_by: null,
  created_at: '2026-09-01T14:00:00Z',
  updated_at: '2026-09-01T14:00:00Z',
};

const RUN: SopRunRow = {
  id: 'run-2',
  sop_id: 'sop-2',
  sop_version: 2,
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
  run_id: 'run-2',
  item_index: 0,
  item_text: 'Empty the bins',
  checked_by: 'marina@pyresauna.com',
  checked_at: '2026-09-01T14:05:00Z',
};

function payload(overrides: Partial<SopDocumentPayload> = {}): SopDocumentPayload {
  return {
    sop: SOP,
    accessLabel: 'Everyone',
    role: 'staff',
    canEdit: false,
    viewerEmail: 'me@pyresauna.com',
    taskCount: 3,
    run: null,
    linked: {},
    people: { 'marina@pyresauna.com': 'Marina' },
    loadedAt: Date.now(),
    ...overrides,
  };
}

const noop = () => {};

describe('PeekChecklist', () => {
  it('renders the shared run as a live checklist pinned to the modal top', () => {
    const html = renderToStaticMarkup(
      <PeekChecklist
        payload={payload({ run: { run: RUN, checks: [CHECK], content: SOP.content_md } })}
        onSopLink={noop}
      />
    );
    expect(html.match(/type="checkbox"/g)?.length).toBe(3);
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('Checklist in progress');
    expect(html).toContain('1 of 3');
    expect(html).toContain('Marina ·');
    expect(html).toContain('sticky top-0');
  });

  it('shows a sub-checklist finished during the parent run as completed', () => {
    const finished = {
      ...RUN,
      status: 'completed' as const,
      ended_by: 'marina@pyresauna.com',
      ended_at: '2026-09-01T14:20:00Z',
    };
    const checks = [0, 1, 2].map((i) => ({ ...CHECK, id: `check-${i}`, item_index: i }));
    const html = renderToStaticMarkup(
      <PeekChecklist
        payload={payload({ run: { run: finished, checks, content: SOP.content_md } })}
        onSopLink={noop}
      />
    );
    expect(html).toContain('>Completed<');
    expect(html).toContain('3 of 3');
    expect(html).toContain('>Start again<');
    expect(html.match(/disabled=""/g)?.length).toBe(3);
  });

  it('is ready for a first tap when nobody has a run open', () => {
    const html = renderToStaticMarkup(<PeekChecklist payload={payload()} onSopLink={noop} />);
    expect(html.match(/type="checkbox"/g)?.length).toBe(3);
    expect(html).not.toContain('Checklist in progress');
  });
});

describe('isChecklistPayload', () => {
  it('is true only for readable documents with tasks', () => {
    expect(isChecklistPayload(payload())).toBe(true);
    expect(isChecklistPayload(payload({ taskCount: 0 }))).toBe(false);
    expect(isChecklistPayload(payload({ sop: { ...SOP, archived: true } }))).toBe(false);
    expect(isChecklistPayload('error')).toBe(false);
  });
});

describe('SopPeekModal', () => {
  it('starts out loading the document', () => {
    const html = renderToStaticMarkup(<SopPeekModal slug="momence-dirty-towels" onClose={noop} />);
    expect(html).toContain('Loading…');
    expect(html).toContain('Open full page');
  });
});
