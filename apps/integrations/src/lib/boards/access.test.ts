import { describe, expect, it } from 'vitest';
import { canViewPage } from '@/components/admin/adminTools';
import {
  canManageBoards,
  canViewBoard,
  canViewBoardsTool,
  canWorkGoal,
  grantedBoardSlugs,
  hasAnyBoardGrant,
  visibleBoards,
} from './access';

const boards = [{ slug: 'goals' }, { slug: 'rentals' }, { slug: 'merch' }];

const admin = { isAdmin: true, pages: [] };
const wholeTool = { isAdmin: false, pages: ['/admin/boards'] };
const oneBoard = { isAdmin: false, pages: ['board:rentals'] };
const legacyGoals = { isAdmin: false, pages: ['/admin/goals'] };
const none = { isAdmin: false, pages: ['/admin/shift-notes'] };

describe('canViewBoard', () => {
  it('lets an admin and a page grant into every board', () => {
    expect(canViewBoard(admin, 'rentals')).toBe(true);
    expect(canViewBoard(admin, 'goals')).toBe(true);
    expect(canViewBoard(wholeTool, 'goals')).toBe(true);
  });

  it('lets a single-board grant into that board only', () => {
    expect(canViewBoard(oneBoard, 'rentals')).toBe(true);
    // The whole point: the community manager on the lead pipeline never sees
    // the founders' task board.
    expect(canViewBoard(oneBoard, 'goals')).toBe(false);
    expect(canViewBoard(oneBoard, 'merch')).toBe(false);
  });

  it('keeps everyone else out', () => {
    expect(canViewBoard(none, 'rentals')).toBe(false);
  });
});

describe('canViewBoardsTool', () => {
  it('shows the tool to anyone with any way in', () => {
    expect(canViewBoardsTool(admin)).toBe(true);
    expect(canViewBoardsTool(wholeTool)).toBe(true);
    expect(canViewBoardsTool(oneBoard)).toBe(true);
    expect(canViewBoardsTool(none)).toBe(false);
  });
});

describe('hasAnyBoardGrant / grantedBoardSlugs', () => {
  it('finds the single-board grants', () => {
    expect(hasAnyBoardGrant(oneBoard)).toBe(true);
    expect(hasAnyBoardGrant(wholeTool)).toBe(false);
    expect(
      grantedBoardSlugs({ isAdmin: false, pages: ['board:a', 'board:b', '/admin/goals'] })
    ).toEqual(['a', 'b']);
  });
});

describe('visibleBoards', () => {
  it('gives an admin every board and a grantee only theirs', () => {
    expect(visibleBoards(admin, boards)).toHaveLength(3);
    expect(visibleBoards(wholeTool, boards)).toHaveLength(3);
    expect(visibleBoards(oneBoard, boards).map((b) => b.slug)).toEqual(['rentals']);
    expect(visibleBoards(none, boards)).toEqual([]);
  });
});

describe('a single-board grant is not the tool grant', () => {
  it('stays one board wide even though the tool is open to it', () => {
    // adminTools.canViewPage('/admin/boards') is true for this row — it has
    // to be, or the board would be unreachable — so the rules here must not
    // be built on top of it.
    expect(canViewPage(oneBoard, '/admin/boards')).toBe(true);
    expect(visibleBoards(oneBoard, boards).map((b) => b.slug)).toEqual(['rentals']);
    expect(canViewBoard(oneBoard, 'goals')).toBe(false);
  });
});

describe('canManageBoards', () => {
  it('is the page grant, not a board grant', () => {
    expect(canManageBoards(admin)).toBe(true);
    expect(canManageBoards(wholeTool)).toBe(true);
    // Working a pipeline is not reshaping the tool.
    expect(canManageBoards(oneBoard)).toBe(false);
    expect(canManageBoards(none)).toBe(false);
  });

  it('honours the grant the old Goals page was issued under', () => {
    // The two pages are one tool now; a row granted /admin/goals before the
    // merge keeps the whole of it.
    expect(canManageBoards(legacyGoals)).toBe(true);
    expect(canViewBoard(legacyGoals, 'rentals')).toBe(true);
    expect(visibleBoards(legacyGoals, boards)).toHaveLength(3);
  });
});

describe('canWorkGoal', () => {
  it('follows the board: whoever can open it can measure its KPIs', () => {
    expect(canWorkGoal(oneBoard, 'rentals')).toBe(true);
    expect(canWorkGoal(oneBoard, 'goals')).toBe(false);
    expect(canWorkGoal(wholeTool, 'goals')).toBe(true);
    expect(canWorkGoal(none, 'rentals')).toBe(false);
  });
});
