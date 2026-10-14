import { describe, expect, it } from 'vitest';
import { canViewBoard } from '@/lib/boards/access';
import {
  ADMIN_TOOLS,
  ALL_TASKS_HREF,
  BOARDS_HREF,
  BUSINESS_TOOL,
  canViewPage,
  canViewPath,
  GOALS_HREF,
  HIDEABLE_TOOLS,
  hasIncidentsManage,
  hasScheduleManage,
  SETTINGS_TOOL,
  STAFF_PAGES,
  SUGGESTIONS_TOOL,
  searchablePages,
  toolsForAccess,
  USERS_TOOL,
  visibleTools,
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

describe('board grants', () => {
  const oneBoard = { isAdmin: false, pages: ['board:rentals'] };

  it('opens the Boards tool and its pages, so a granted board is reachable', () => {
    expect(canViewPage(oneBoard, BOARDS_HREF)).toBe(true);
    expect(canViewPath(oneBoard, '/admin/boards')).toBe(true);
    expect(canViewPath(oneBoard, '/admin/boards/rentals')).toBe(true);
    expect(toolsForAccess(oneBoard).map((t) => t.href)).toEqual([BOARDS_HREF]);
  });

  it('leaves the founders’ boards alone', () => {
    // canViewPath lets /admin/boards/* through — the board page itself
    // checks the slug against the grant — but the boards themselves stay
    // shut, and All Tasks (which spans every board) is refused by its page.
    expect(canViewBoard(oneBoard, 'goals')).toBe(false);
    expect(canViewBoard(oneBoard, 'rentals')).toBe(true);
    expect(canViewPage(oneBoard, GOALS_HREF)).toBe(false);
  });

  it('carries a grant for the old Goals page onto the merged tool', () => {
    const goalsOnly = { isAdmin: false, pages: [GOALS_HREF] };
    expect(toolsForAccess(goalsOnly).map((t) => t.href)).toEqual([BOARDS_HREF]);
    expect(canViewPage(goalsOnly, BOARDS_HREF)).toBe(true);
    expect(canViewPath(goalsOnly, ALL_TASKS_HREF)).toBe(true);
    expect(canViewPath(goalsOnly, '/admin/boards/rentals')).toBe(true);
    expect(canViewBoard(goalsOnly, 'rentals')).toBe(true);
  });

  it('offers one tool, not two', () => {
    const hrefs = ADMIN_TOOLS.map((t) => t.href);
    expect(hrefs).toContain(BOARDS_HREF);
    expect(hrefs).not.toContain(GOALS_HREF);
    expect(ALL_TASKS_HREF.startsWith(`${BOARDS_HREF}/`)).toBe(true);
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

const everyPage = { isAdmin: true, pages: ADMIN_TOOLS.map((tool) => tool.href) };

describe('every page is an explicit grant', () => {
  it('opens no page for the admin flag alone', () => {
    const bareAdmin = { isAdmin: true, pages: [] };
    expect(toolsForAccess(bareAdmin)).toEqual([]);
    expect(canViewPage(bareAdmin, BUSINESS_TOOL.href)).toBe(false);
    expect(canViewPath(bareAdmin, '/admin/users')).toBe(false);
    expect(canViewPath(bareAdmin, '/admin/schedule/insights')).toBe(false);
    // The directory and the staff pages are still everyone's.
    expect(canViewPath(bareAdmin, '/admin')).toBe(true);
    expect(canViewPath(bareAdmin, '/admin/messages')).toBe(true);
  });

  it('grants the formerly admin-only pages like any other', () => {
    const finance = { isAdmin: false, pages: [BUSINESS_TOOL.href] };
    expect(toolsForAccess(finance)).toEqual([BUSINESS_TOOL]);
    expect(canViewPath(finance, BUSINESS_TOOL.href)).toBe(true);
    expect(canViewPath(finance, SETTINGS_TOOL.href)).toBe(false);
    for (const tool of [BUSINESS_TOOL, USERS_TOOL, SUGGESTIONS_TOOL, SETTINGS_TOOL]) {
      expect(ADMIN_TOOLS).toContain(tool);
    }
  });

  it('keeps admin manage powers inside the pages held', () => {
    expect(hasScheduleManage({ isAdmin: true, pages: ['/admin/schedule'] })).toBe(true);
    expect(hasScheduleManage({ isAdmin: true, pages: ['/admin/water'] })).toBe(false);
    expect(hasIncidentsManage({ isAdmin: true, pages: [] })).toBe(false);
    // The capability key still works on its own, as before.
    expect(hasScheduleManage({ isAdmin: false, pages: ['schedule:manage'] })).toBe(true);
  });
});

describe('global tool visibility', () => {
  it.each([true, false])(
    'hides listings and subpage search without changing access (admin=%s)',
    (isAdmin) => {
      const access = { isAdmin, pages: ['/admin/schedule', '/admin/water'] };
      const tools = visibleTools(toolsForAccess(access), ['/admin/schedule']);
      expect(tools.map((tool) => tool.href)).not.toContain('/admin/schedule');
      expect(tools.map((tool) => tool.href)).toContain('/admin/water');
      expect(
        searchablePages(tools, isAdmin).some(
          (page) => page.href === '/admin/schedule' || page.href.startsWith('/admin/schedule/')
        )
      ).toBe(false);
      expect(canViewPath(access, '/admin/schedule/timesheet')).toBe(true);
    }
  );

  it('keeps Settings and staff pages reachable when every tool is hidden', () => {
    expect(HIDEABLE_TOOLS).not.toContainEqual(SETTINGS_TOOL);
    const tools = visibleTools(toolsForAccess(everyPage), [
      ...HIDEABLE_TOOLS.map((t) => t.href),
      SETTINGS_TOOL.href,
    ]);
    expect(tools).toEqual([SETTINGS_TOOL]);
    expect(searchablePages(tools, true).map((page) => page.href)).toEqual(
      expect.arrayContaining(['/admin', '/admin/settings', ...STAFF_PAGES.map((p) => p.href)])
    );
  });

  it('restores the original listing when nothing is hidden', () => {
    const tools = toolsForAccess(everyPage);
    expect(visibleTools(tools, [])).toEqual(tools);
  });
});
