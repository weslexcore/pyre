import { describe, expect, it } from 'vitest';
import {
  ADMIN_TOOLS,
  canViewPage,
  canViewPath,
  STAFF_PAGES,
  searchablePages,
  toolsForAccess,
} from './adminTools';

describe('legacy page grants', () => {
  const legacyOnly = { isAdmin: false, pages: ['/admin/utm-assist'] };

  it('lets a staff row granted the old UTM Assist page open the Campaigns hub', () => {
    expect(canViewPage(legacyOnly, '/admin/campaigns')).toBe(true);
    expect(canViewPath(legacyOnly, '/admin/campaigns/new')).toBe(true);
    expect(canViewPath(legacyOnly, '/admin/campaigns/some-id')).toBe(true);
    expect(toolsForAccess(legacyOnly).map((t) => t.href)).toEqual(['/admin/campaigns']);
  });

  it('does not widen the alias to other pages', () => {
    expect(canViewPage(legacyOnly, '/admin/water')).toBe(false);
  });

  it('no longer offers the old page as a tool', () => {
    expect(ADMIN_TOOLS.some((t) => t.href === '/admin/utm-assist')).toBe(false);
  });
});

describe('staff pages', () => {
  const rosterOnly = { isAdmin: false, pages: [] as string[] };

  it('lets anyone with dashboard access open messages and notifications', () => {
    expect(canViewPage(rosterOnly, '/admin/messages')).toBe(true);
    expect(canViewPage(rosterOnly, '/admin/notifications')).toBe(true);
    expect(canViewPath(rosterOnly, '/admin/messages')).toBe(true);
    expect(canViewPath(rosterOnly, '/admin/messages/8f5c1f2e-1111-4222-8333-444455556666')).toBe(
      true
    );
    expect(canViewPath(rosterOnly, '/admin/notifications')).toBe(true);
  });

  it('does not widen access to sibling pages', () => {
    expect(canViewPath(rosterOnly, '/admin/messagesx')).toBe(false);
    expect(canViewPath(rosterOnly, '/admin/water')).toBe(false);
  });

  it('never offers them as grantable tools or dashboard cards', () => {
    expect(ADMIN_TOOLS.some((t) => STAFF_PAGES.some((p) => p.href === t.href))).toBe(false);
    expect(toolsForAccess(rosterOnly)).toEqual([]);
  });

  it('lists them in the global search for everyone', () => {
    const hrefs = searchablePages(toolsForAccess(rosterOnly), false).map((p) => p.href);
    expect(hrefs).toContain('/admin/messages');
    expect(hrefs).toContain('/admin/notifications');
  });
});
