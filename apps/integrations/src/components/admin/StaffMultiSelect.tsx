// Multi-select staff filter for the manage-side schedule views (week board,
// month calendar, time off): pick whose time to look at. An empty selection
// means everyone — the filter only narrows, it never hides the whole board.

import type { StaffRow } from '@/lib/db';
import { FilterMultiSelect } from './FilterMultiSelect';
import { filterChipClass } from './scheduleUi';

export function StaffMultiSelect({
  staff,
  selected,
  onChange,
}: {
  staff: StaffRow[];
  selected: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
}) {
  const active = staff.filter((s) => s.active);
  const label =
    selected.size === 0
      ? 'Everyone'
      : selected.size === 1
        ? (active.find((s) => selected.has(s.id))?.display_name ?? '1 person')
        : `${selected.size} people`;

  return (
    <FilterMultiSelect
      placeholder="Staff"
      options={active.map((s) => ({ value: s.id, label: s.display_name }))}
      selected={selected}
      onChange={onChange}
      buttonClassName={filterChipClass(selected.size > 0)}
      title="Filter to specific people's shifts and time off"
      renderLabel={() => `👤 ${label} ▾`}
      clearLabel="Clear — show everyone"
      panelClassName="min-w-[200px]"
    />
  );
}
