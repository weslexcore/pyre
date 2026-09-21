import { describe, expect, it } from 'vitest';
import { reorderColumns } from '@/components/admin/boards/ColumnOrder';

describe('settings column order', () => {
  const columns = [
    { key: 'todo', label: 'Renamed draft', kind: 'open', archived: false },
    { key: 'doing', label: 'Doing', kind: 'active', archived: true },
    { key: 'new_column', label: 'Unsaved column', kind: 'open', archived: false },
  ];

  it('moves a column to the end without losing draft edits or mutating the original', () => {
    const next = reorderColumns(columns, 'todo', 'new_column');
    expect(next).toEqual([columns[1], columns[2], columns[0]]);
    expect(next[2]).toBe(columns[0]);
    expect(columns.map((column) => column.key)).toEqual(['todo', 'doing', 'new_column']);
  });

  it('moves a newly added column to the start, retaining retired columns', () => {
    expect(reorderColumns(columns, 'new_column', 'todo')).toEqual([
      columns[2],
      columns[0],
      columns[1],
    ]);
  });

  it('ignores missing targets and unchanged positions', () => {
    expect(reorderColumns(columns, 'todo', 'missing')).toBe(columns);
    expect(reorderColumns(columns, 'missing', 'doing')).toBe(columns);
    expect(reorderColumns(columns, 'todo', 'todo')).toBe(columns);
  });
});
