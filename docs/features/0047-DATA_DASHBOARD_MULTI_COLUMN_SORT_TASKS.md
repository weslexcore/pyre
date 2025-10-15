## Relevant Files

- `apps/data-dashboard/components/dashboard/data-table.tsx` (Existing) - Main Session Explorer table; needs multi-column sort state, UI entry point, and header indicators.
- `apps/data-dashboard/components/dashboard/data-table.test.tsx` (Existing) - Rendering tests that cover sorting, persistence, and accessibility; expand for multi-column flows.
- `apps/data-dashboard/lib/session-sort.ts` (Existing) - Session storage helpers; must serialize multi-column stacks and handle dataset signature invalidation.
- `apps/data-dashboard/components/dashboard/sort-panel.tsx` (New) - Dedicated, accessible control surface for composing, reordering, and toggling the sort stack.
- `apps/data-dashboard/lib/multi-sort.ts` (New) - Shared comparator utilities so table views and exports reuse the same multi-column ordering logic.
- `apps/data-dashboard/lib/export.ts` (New) - Centralizes CSV export to guarantee it uses the sorted dataset before generating files.
- `apps/data-dashboard/components/ui/dialog.tsx` (New) - Radix-based dialog primitives reused for sort configuration and future modals.

### Notes

- Co-locate unit tests next to their source files (e.g., `sort-panel.test.tsx`, `multi-sort.test.ts`).
- Guard sessionStorage usage for SSR/private mode just like existing helpers.
- Maintain `Date desc` as the default whenever the sort stack is empty or invalid.

## Tasks

- [ ] 1.0 Extend sort infrastructure to support multi-column definitions and sessionStorage persistence with dataset signature safeguards.
  - [x] 1.1 Define a `MultiSortState` structure (column + direction array) and map existing `SortDefinition` metadata to support priority stacks.
  - [x] 1.2 Refactor comparator utilities into reusable helpers that iterate the priority list and fall back to column tie-breakers when needed.
  - [x] 1.3 Update `session-sort.ts` to read/write the new multi-column payload, migrate legacy single-column entries, and clear mismatched signatures.
  - [x] 1.4 Initialize the table with stored stacks, handling default fallback when the dataset changes, is empty, or stored columns are no longer available.
- [ ] 2.0 Implement the “Sort columns” configuration UI with accessible controls for building, reordering, and removing a prioritized sort stack.
  - [x] 2.1 Add the trigger control in the Session Explorer header and surface available sortable columns plus helper copy.
  - [x] 2.2 Build `SortPanel` with toggles, direction cycling, priority badges, and keyboard-friendly reorder buttons (e.g., move up/down).
  - [x] 2.3 Connect panel interactions to the table state so apply/cancel flows update the stack, renumber priorities, and sync with session storage.
  - [x] 2.4 Render priority badges/icons on table headers and preserve quick single-column toggling for the active top priority.
- [ ] 3.0 Apply multi-column sorting across table rendering, filters, pagination, and CSV export flows, including header priority indicators.
  - [ ] 3.1 Replace the single-column `sortRecords` pipeline with the new multi-column comparator before pagination, keeping filters applied first.
  - [ ] 3.2 Reset pagination and fall back to `Date desc` whenever the stack clears or dataset signature invalidates the stored configuration.
  - [ ] 3.3 Reuse the shared comparator in the CSV export helper so downloaded files mirror the on-screen order.
  - [ ] 3.4 Validate stored stacks against the available column map, dropping unknown entries and notifying users via the panel when adjustments occur.
- [ ] 4.0 Add automated coverage and documentation updates for the new multi-column sort experience.
  - [ ] 4.1 Expand component tests to cover building/reordering the stack, keyboard flows, storage persistence, and visual header indicators.
  - [ ] 4.2 Add unit tests for comparator and session storage helpers, including signature mismatch handling and legacy migration.
  - [ ] 4.3 Update dashboard documentation/release notes with configuration steps and CSV QA guidance for multi-column sort.
