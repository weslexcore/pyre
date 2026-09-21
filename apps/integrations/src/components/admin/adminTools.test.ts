import { describe, expect, it } from 'vitest';
import { canViewBoard } from '@/lib/boards/access';
import {
  ADMIN_TOOLS,
  ALL_TASKS_HREF,
  BOARDS_HREF,
  canViewPage,
  canViewPath,
  GOALS_HREF,
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

describe('board grants', () => {
  const oneBoard = { isAdmin: false, pages: ['board:rentals'] };

  it('opens the Boards tool and its pages, so a granted board is reachable', () => {
    expect(canViewPage(oneBoard, BOARDS_HREF)).toBe(true);
    expect(canViewPath(oneBoard, '/admin/boards')).toBe(true);
    expect(canViewPath(oneBoard, '/admin/boards/rentals')).toBe(true);
    expect(toolsForAccess(oneBoard).map((t) => t.href)).toEqual([BOARDS_HREF]);
  });

  it('leaves the founders’ goals alone', () => {
    // canViewPath lets /admin/boards/goals through — the board page itself
    // checks the slug against the grant — but the Goals tool stays shut.
    expect(canViewPage(oneBoard, GOALS_HREF)).toBe(false);
    expect(canViewPath(oneBoard, GOALS_HREF)).toBe(false);
    expect(canViewPath(oneBoard, ALL_TASKS_HREF)).toBe(false);
    expect(canViewBoard(oneBoard, 'goals')).toBe(false);
    expect(canViewBoard(oneBoard, 'rentals')).toBe(true);
  });

  it('does not let a goals grant wander onto the boards', () => {
    const goalsOnly = { isAdmin: false, pages: [GOALS_HREF] };
    expect(toolsForAccess(goalsOnly).map((t) => t.href)).toEqual([GOALS_HREF]);
    expect(canViewPath(goalsOnly, ALL_TASKS_HREF)).toBe(true);
    expect(canViewPath(goalsOnly, '/admin/goals/3f1b8a2c')).toBe(true);
    expect(canViewPage(goalsOnly, BOARDS_HREF)).toBe(false);
  });

  it('offers both tools as grantable pages', () => {
    const hrefs = ADMIN_TOOLS.map((t) => t.href);
    expect(hrefs).toContain(GOALS_HREF);
    expect(hrefs).toContain(BOARDS_HREF);
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
