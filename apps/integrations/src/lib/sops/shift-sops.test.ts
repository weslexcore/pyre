import { DEFAULT_DUTY_CATALOG, type DutyCatalog } from '@pyre/schedule-core';
import { describe, expect, it } from 'vitest';
import type { SopRow } from '@/lib/db';
import type { SopRole, SopViewer } from './levels';
import { resolveShiftSops as resolve } from './shift-sops';

/** The SOP slug a default duty links to. */
const slugOf = (key: string): string =>
  DEFAULT_DUTY_CATALOG.find((d) => d.key === key)?.sopSlug as string;

const resolveShiftSops = (
  duties: string[],
  rows: SopRow[],
  viewer: SopViewer,
  catalog: DutyCatalog = DEFAULT_DUTY_CATALOG
) => resolve(catalog, duties, rows, viewer);

const sop = (slug: string, over: Partial<SopRow> = {}): SopRow =>
  ({
    id: slug,
    slug,
    title: slug,
    category: 'Shift',
    content_md: '# Doc\n',
    view_roles: ['staff', 'shift_lead', 'admin'],
    edit_roles: ['admin'],
    view_emails: [],
    edit_emails: [],
    archived: false,
    updated_by: null,
    ...over,
  }) as SopRow;

const viewer = (role: SopRole, email = ''): SopViewer => ({ role, email });

describe('resolveShiftSops', () => {
  it('pairs each duty with its document, keeping the duty order', () => {
    const rows = [sop(slugOf('breakdown_a')), sop(slugOf('setup_a')), sop(slugOf('customer_care'))];
    const resolved = resolveShiftSops(
      ['setup_a', 'customer_care', 'breakdown_a'],
      rows,
      viewer('staff')
    );
    expect(resolved.map((s) => s.duty)).toEqual(['setup_a', 'customer_care', 'breakdown_a']);
    expect(resolved[0].label).toBe('Set Up (A)');
    // The letter alone doesn't say which half it is; the detail does.
    expect(resolved[0].detail).toBe('Fire + Water');
    expect(resolved[1].detail).toBeNull();
  });

  it('counts the checklist items so a runnable document can say so', () => {
    const rows = [sop(slugOf('host'), { content_md: '- [ ] one\n- [ ] two\n' })];
    expect(resolveShiftSops(['host'], rows, viewer('staff'))[0].taskCount).toBe(2);
    expect(
      resolveShiftSops(['setup_a'], [sop(slugOf('setup_a'))], viewer('staff'))[0].taskCount
    ).toBe(0);
  });

  it('drops a duty whose document this viewer may not open', () => {
    const rows = [
      sop(slugOf('setup_a'), { view_roles: ['admin'], edit_roles: ['admin'] }),
      sop(slugOf('breakdown_a')),
    ];
    expect(resolveShiftSops(['setup_a', 'breakdown_a'], rows, viewer('staff'))).toHaveLength(1);
    // The same shift, for someone who may read both.
    expect(resolveShiftSops(['setup_a', 'breakdown_a'], rows, viewer('admin'))).toHaveLength(2);
  });

  it('drops a duty whose document does not exist yet', () => {
    expect(resolveShiftSops(['setup_b'], [], viewer('staff'))).toEqual([]);
  });

  it('follows a personal grant, like every other access check', () => {
    const rows = [
      sop(slugOf('host'), {
        view_roles: ['admin'],
        edit_roles: ['admin'],
        view_emails: ['ada@pyre.test'],
      }),
    ];
    expect(resolveShiftSops(['host'], rows, viewer('staff', 'ada@pyre.test'))).toHaveLength(1);
    expect(resolveShiftSops(['host'], rows, viewer('staff', 'bob@pyre.test'))).toEqual([]);
  });

  it('follows the catalog when an admin re-links or unlinks a duty', () => {
    const relinked = DEFAULT_DUTY_CATALOG.map((d) =>
      d.key === 'host' ? { ...d, label: 'Front of House', sopSlug: 'front-of-house' } : d
    );
    const rows = [sop('front-of-house'), sop(slugOf('host'))];
    const [resolved] = resolveShiftSops(['host'], rows, viewer('staff'), relinked);
    expect(resolved.slug).toBe('front-of-house');
    expect(resolved.label).toBe('Front of House');

    const unlinked = DEFAULT_DUTY_CATALOG.map((d) =>
      d.key === 'host' ? { ...d, sopSlug: null } : d
    );
    expect(resolveShiftSops(['host'], rows, viewer('staff'), unlinked)).toEqual([]);
  });
});
