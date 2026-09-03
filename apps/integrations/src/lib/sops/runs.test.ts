import { describe, expect, it } from 'vitest';
import type { SopAccessFields, SopRole, SopViewer } from './levels';
import { visibleSopIds } from './runs';

type Row = SopAccessFields & { id: string };

const sop = (id: string, grants: Partial<SopAccessFields> = {}): Row => ({
  id,
  view_roles: ['staff', 'shift_lead', 'admin'],
  edit_roles: ['admin'],
  view_emails: [],
  edit_emails: [],
  archived: false,
  ...grants,
});

const viewer = (role: SopRole, email = ''): SopViewer => ({ role, email });

describe('visibleSopIds', () => {
  it('gives an admin every document, archived and restricted alike', () => {
    const rows = [
      sop('open'),
      sop('locked', { view_roles: ['admin'], edit_roles: ['admin'] }),
      sop('old', { archived: true }),
    ];
    expect(visibleSopIds(viewer('admin'), rows)).toEqual(['open', 'locked', 'old']);
  });

  it('keeps only the documents a staff viewer may open', () => {
    const rows = [
      sop('open'),
      sop('leads-only', { view_roles: ['shift_lead'], edit_roles: ['admin'] }),
    ];
    expect(visibleSopIds(viewer('staff'), rows)).toEqual(['open']);
  });

  it('includes a document the viewer is named on personally', () => {
    const rows = [sop('named', { view_roles: ['admin'], view_emails: ['ada@pyre.test'] })];
    expect(visibleSopIds(viewer('staff', 'ada@pyre.test'), rows)).toEqual(['named']);
    expect(visibleSopIds(viewer('staff', 'bob@pyre.test'), rows)).toEqual([]);
  });

  it('drops archived documents for a non-admin, so their runs leave the log', () => {
    expect(visibleSopIds(viewer('staff'), [sop('old', { archived: true })])).toEqual([]);
  });

  it('returns nothing when the viewer is granted nothing', () => {
    const rows = [sop('locked', { view_roles: ['admin'], edit_roles: ['admin'] })];
    expect(visibleSopIds(viewer('staff'), rows)).toEqual([]);
    expect(visibleSopIds(viewer('staff'), [])).toEqual([]);
  });
});
