import { describe, expect, it } from 'vitest';
import { ADMIN_TOOLS, canViewPage, canViewPath, toolsForAccess } from './adminTools';

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
