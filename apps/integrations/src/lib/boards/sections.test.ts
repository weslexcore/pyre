import { describe, expect, it } from 'vitest';
import {
  boardsInOrder,
  groupBySection,
  moveBoardToSectionEnd,
  repositionBoard,
  repositionSection,
  sectionsInOrder,
} from './sections';

const section = (id: string, sort_order: number, name = id) => ({ id, name, sort_order });
const board = (id: string, section_id: string | null, sort_order = 0) => ({
  id,
  name: id,
  section_id,
  sort_order,
});

const SECTIONS = [section('ops', 1, 'Operations'), section('growth', 0, 'Growth')];

describe('ordering', () => {
  it('ranks sections by position and boards by section, then hand order', () => {
    expect(sectionsInOrder(SECTIONS).map((s) => s.id)).toEqual(['growth', 'ops']);
    const boards = [
      board('a', 'ops', 20),
      board('b', null),
      board('c', 'growth'),
      board('d', 'ops', 10),
    ];
    expect(boardsInOrder(boards, SECTIONS).map((b) => b.id)).toEqual(['c', 'd', 'a', 'b']);
  });

  it('groups with empty sections kept and the unnamed group last, only when used', () => {
    const groups = groupBySection(SECTIONS, [board('a', 'ops'), board('b', null)]);
    expect(groups.map((g) => g.section?.id ?? null)).toEqual(['growth', 'ops', null]);
    expect(groups[0].boards).toEqual([]);
    expect(groups[2].boards.map((b) => b.id)).toEqual(['b']);
    expect(groupBySection(SECTIONS, [board('a', 'ops')])).toHaveLength(2);
  });

  it('treats a board pointing at a section that is gone as unnamed', () => {
    const groups = groupBySection(SECTIONS, [board('a', 'ghost')]);
    expect(groups[groups.length - 1]).toMatchObject({ section: null });
  });
});

describe('repositionBoard', () => {
  const boards = [board('a', 's1'), board('b', 's1'), board('c', 's2')];

  it('drops after the target when dragging down and before it when dragging up', () => {
    expect(repositionBoard(boards, 'a', 'b').map((b) => b.id)).toEqual(['b', 'a', 'c']);
    expect(repositionBoard(boards, 'c', 'a').map((b) => b.id)).toEqual(['c', 'a', 'b']);
  });

  it('adopts the target section', () => {
    const next = repositionBoard(boards, 'a', 'c');
    expect(next.find((b) => b.id === 'a')?.section_id).toBe('s2');
  });

  it('leaves the list alone for a no-op', () => {
    expect(repositionBoard(boards, 'a', 'a')).toBe(boards);
    expect(repositionBoard(boards, 'a', 'zz')).toBe(boards);
  });
});

describe('moveBoardToSectionEnd', () => {
  const boards = [board('a', 's1'), board('b', 's1'), board('c', 's2')];

  it('goes to the end of the section, or the end of the list for an empty one', () => {
    expect(moveBoardToSectionEnd(boards, 'a', 's2').map((b) => [b.id, b.section_id])).toEqual([
      ['b', 's1'],
      ['c', 's2'],
      ['a', 's2'],
    ]);
    expect(moveBoardToSectionEnd(boards, 'a', null).map((b) => b.id)).toEqual(['b', 'c', 'a']);
    expect(moveBoardToSectionEnd(boards, 'a', null)[2].section_id).toBeNull();
  });

  it('is a no-op when already last in that section', () => {
    expect(moveBoardToSectionEnd(boards, 'b', 's1')).toBe(boards);
  });
});

describe('repositionSection', () => {
  it('moves a heading and renumbers from zero', () => {
    const next = repositionSection([...SECTIONS, section('people', 2)], 'people', 'growth');
    expect(next.map((s) => [s.id, s.sort_order])).toEqual([
      ['people', 0],
      ['growth', 1],
      ['ops', 2],
    ]);
  });
});
