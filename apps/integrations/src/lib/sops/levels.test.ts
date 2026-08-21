import { describe, expect, it } from 'vitest';
import {
  canEditSop,
  canViewSop,
  describeGrants,
  effectiveViewGrants,
  isEveryoneGranted,
  type SopAccessFields,
  type SopRole,
  type SopViewer,
} from './levels';

const sop = (grants: Partial<SopAccessFields> = {}): SopAccessFields => ({
  view_roles: ['staff', 'shift_lead', 'admin'],
  edit_roles: ['admin'],
  view_emails: [],
  edit_emails: [],
  archived: false,
  ...grants,
});

const viewer = (role: SopRole, email = ''): SopViewer => ({ role, email });

describe('canViewSop', () => {
  it('grants a role named in the view set', () => {
    expect(canViewSop(viewer('shift_lead'), sop({ view_roles: ['shift_lead'] }))).toBe(true);
  });

  it('does not leak down the old tier ladder', () => {
    // The whole point of sets: granting shift leads no longer grants staff.
    expect(canViewSop(viewer('staff'), sop({ view_roles: ['shift_lead'] }))).toBe(false);
  });

  it('grants someone named individually whatever their role', () => {
    const doc = sop({ view_roles: ['admin'], view_emails: ['ada@pyre.test'] });
    expect(canViewSop(viewer('staff', 'ada@pyre.test'), doc)).toBe(true);
    expect(canViewSop(viewer('staff', 'bob@pyre.test'), doc)).toBe(false);
  });

  it('treats an edit grant as a view grant', () => {
    const doc = sop({ view_roles: ['admin'], edit_emails: ['ada@pyre.test'] });
    expect(canViewSop(viewer('staff', 'ada@pyre.test'), doc)).toBe(true);
  });

  it('never matches an empty session email against an empty grant list', () => {
    expect(canViewSop(viewer('staff', ''), sop({ view_roles: [], view_emails: [] }))).toBe(false);
  });

  it('hides archived documents from everyone but admins', () => {
    const doc = sop({ archived: true, view_emails: ['ada@pyre.test'] });
    expect(canViewSop(viewer('staff', 'ada@pyre.test'), doc)).toBe(false);
    expect(canViewSop(viewer('admin'), doc)).toBe(true);
  });

  it('lets admins read a document that grants them nothing', () => {
    expect(canViewSop(viewer('admin'), sop({ view_roles: [], edit_roles: [] }))).toBe(true);
  });
});

describe('canEditSop', () => {
  it('requires the edit grant, not the view grant', () => {
    const doc = sop({ view_roles: ['staff'], edit_roles: ['admin'] });
    expect(canViewSop(viewer('staff'), doc)).toBe(true);
    expect(canEditSop(viewer('staff'), doc)).toBe(false);
  });

  it('grants an individually named editor', () => {
    const doc = sop({ edit_roles: ['admin'], edit_emails: ['ada@pyre.test'] });
    expect(canEditSop(viewer('staff', 'ada@pyre.test'), doc)).toBe(true);
  });

  it('freezes archived documents for non-admins', () => {
    const doc = sop({ archived: true, edit_emails: ['ada@pyre.test'] });
    expect(canEditSop(viewer('staff', 'ada@pyre.test'), doc)).toBe(false);
    expect(canEditSop(viewer('admin'), doc)).toBe(true);
  });
});

describe('effectiveViewGrants', () => {
  it('folds the edit grants into the view grants', () => {
    expect(
      effectiveViewGrants(
        sop({
          view_roles: ['staff'],
          edit_roles: ['shift_lead'],
          view_emails: ['ada@pyre.test'],
          edit_emails: ['ada@pyre.test', 'bob@pyre.test'],
        })
      )
    ).toEqual({
      roles: ['staff', 'shift_lead'],
      emails: ['ada@pyre.test', 'bob@pyre.test'],
    });
  });
});

describe('describeGrants', () => {
  it('collapses a full role set to "Everyone"', () => {
    expect(describeGrants(['staff', 'shift_lead', 'admin'], [])).toBe('Everyone');
  });

  it('counts named people', () => {
    expect(describeGrants(['admin'], ['ada@pyre.test'])).toBe('Admins + 1 person');
    expect(describeGrants(['admin'], ['ada@pyre.test', 'bob@pyre.test'])).toBe('Admins + 2 people');
  });

  it('names an empty grant rather than rendering nothing', () => {
    expect(describeGrants([], [])).toBe('Nobody');
  });

  it('lists roles in rank order however they were stored', () => {
    expect(describeGrants(['admin', 'staff'], [])).toBe('Staff + Admins');
  });
});

describe('isEveryoneGranted', () => {
  it('is true only when every role is present', () => {
    expect(isEveryoneGranted(['staff', 'shift_lead', 'admin'])).toBe(true);
    expect(isEveryoneGranted(['staff', 'admin'])).toBe(false);
  });
});
