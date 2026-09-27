import { describe, expect, it } from 'vitest';
import type { SopRow } from '@/lib/db';
import { sopsForViewer } from './sops';

function sop(overrides: Partial<SopRow>): SopRow {
  return {
    id: 'id',
    slug: 'slug',
    title: 'Title',
    content_md: '',
    category: 'General',
    view_roles: ['staff', 'shift_lead', 'admin'],
    edit_roles: ['admin'],
    view_emails: [],
    edit_emails: [],
    sort_order: 0,
    archived: false,
    current_version: 1,
    created_by: null,
    updated_by: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

const rentals = sop({ id: 'a', slug: 'rentals', title: 'Rentals' });
const groups = sop({ id: 'b', slug: 'group-bookings', title: 'Group bookings' });
const leadsOnly = sop({ id: 'c', slug: 'pricing', view_roles: ['shift_lead', 'admin'] });
const archived = sop({ id: 'd', slug: 'old', archived: true });
const linked = [rentals, groups, leadsOnly, archived];

const sopsPage = { isAdmin: false, pages: ['/admin/sops', 'board:rentals'] };
const staff = { role: 'staff' as const, email: 'staff@example.com' };

describe('sopsForViewer', () => {
  it('keeps the board order and trims each SOP to what the board shows', () => {
    expect(sopsForViewer([groups, rentals], sopsPage, staff)).toEqual([
      { id: 'b', slug: 'group-bookings', title: 'Group bookings' },
      { id: 'a', slug: 'rentals', title: 'Rentals' },
    ]);
  });

  it('drops the SOPs this viewer may not read, and archived ones', () => {
    expect(sopsForViewer(linked, sopsPage, staff).map((s) => s.slug)).toEqual([
      'rentals',
      'group-bookings',
    ]);
  });

  it('never shows an archived SOP, even to an admin', () => {
    const admin = { isAdmin: true, pages: [] };
    expect(
      sopsForViewer(linked, admin, { role: 'admin', email: 'a@example.com' }).map((s) => s.slug)
    ).toEqual(['rentals', 'group-bookings', 'pricing']);
  });
});
