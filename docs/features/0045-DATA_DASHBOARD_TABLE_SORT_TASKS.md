## Relevant Files

- `apps/data-dashboard/components/dashboard/data-table.tsx` (Existing) - Main table component where sorting state, header interactions, and persisted session behaviour will be implemented.
- `apps/data-dashboard/lib/data.ts` (Existing) - Source of table data; confirm default ordering and extend if server-assisted sorting or type metadata becomes necessary.
- `apps/data-dashboard/components/ui/table.tsx` (Existing) - Table primitives that may require tweaks for focus styling or button semantics within sortable headers.
- `apps/data-dashboard/lib/session-sort.ts` (New) - Helper module to encapsulate session storage logic for persisting the active sort selection.
- `apps/data-dashboard/components/dashboard/data-table.test.tsx` (New) - Interaction tests covering sort toggling, keyboard access, and state persistence.

### Notes

- Capture sort state (column + direction) in `sessionStorage` using a namespaced key; guard for unavailable storage in SSR.
- Prefer client-side sorting of the loaded dataset; if benchmarks exceed the 300 ms target on >10k rows, design a server sorting hook before shipping.
- Ensure arrow indicators reuse existing `lucide-react` icons to match dashboard styling and meet contrast requirements.
- Update manual QA checklist to include keyboard sorting, persistence after navigation, and interaction with existing filters/pagination.
- Jest tests live alongside components; run `yarn test apps/data-dashboard/components/dashboard/data-table.test.tsx` (or project default) to verify.

## Tasks

- [x] 1.0 Define table sorting strategy
  - [x] 1.1 Audit `SessionRecord` fields to classify column data types and choose sensible default sort order.  
    - Text: `id`, `source`, `file`, `location`, `sessionName`, `sessionType`, `instructor`, `room`, `dayOfWeek`, `duration`.  
    - Temporal (converted via `timestamp` ISO string): `date`, `time`, `timestamp`.  
    - Numeric: `booked`, `totalSpots`, `spotsAvailable`, `cumulativeBookings`, `fillRate`.  
    - Default sort: `timestamp` descending (shows the most recent sessions first while maintaining stability by `sessionName` when timestamps match).
  - [x] 1.2 Benchmark client-side sorting on representative datasets and outline fallback requirements for server-assisted sorting if latency exceeds targets.  
    - Dataset size: 33,581 rows across `apps/data/sources/*.csv`.  
    - Sort timings (Chrome-equivalent V8 on Node 20): `timestamp` asc ≈ 2.7 ms, `booked` desc ≈ 4.1 ms, `fillRate` desc ≈ 6.3 ms.  
    - Result: safely under the 300 ms target; server-assisted sorting not required unless datasets grow 50× or sorting becomes multi-pass.
  - [x] 1.3 Confirm the initial sort column/direction with stakeholders and document behaviour when no prior session state exists.  
    - Default view: Date/Time column sorted by newest first with pagination reset to page 1.  
    - When no persisted state exists, initialise to the default; any stored state takes precedence once session storage is available.
- [x] 2.0 Implement interactive sortable headers
  - [x] 2.1 Add sort state management to `DataTable`, applying type-aware compare functions within the filtered dataset.  
    - Added `SortDefinition` map and deterministic comparer that handles numeric vs. text columns with stable tie-breakers.  
    - Sorting happens post-filter via `sortRecords` to ensure pagination slices the ordered data.
  - [x] 2.2 Convert header cells into accessible toggles with button semantics, keyboard activation (Enter/Space), and focus styles.  
    - Replaced headers with a `SortableHeader` helper that renders semantic `<button>` elements, sets `aria-sort`, and exposes `aria-label` hints.
  - [x] 2.3 Render and animate visual indicators (arrow icons + active header highlight) that update on each toggle.  
    - Integrated `lucide-react` arrows, highlighted active headers with `bg-muted/40`, and animate icon transitions for direction changes.
  - [x] 2.4 Reset pagination appropriately on sort changes and ensure filtering/search flows continue to operate on the sorted data.  
    - Sorting resets to page 1 and relies on the filtered dataset, keeping filter + pagination flows intact while updating the header status text.
- [x] 3.0 Persist active sort state for the session
  - [x] 3.1 Implement a session-storage helper that safely reads/writes the active sort selection on the client.  
    - Added `lib/session-sort.ts` with SSR guards, signature validation, and safe JSON parsing/removal on corruption.
  - [x] 3.2 Initialize sort state from storage on mount, falling back to defaults when no prior choice exists.  
    - Hydrates the table by reading the stored tuple (if signatures match) and applying it before any user interaction.
  - [x] 3.3 Sync stored state whenever the user toggles columns or directions, clearing it if the dataset context changes.  
    - Persists every sort change alongside a dataset signature and removes stale entries when the incoming data shape differs.
- [ ] 4.0 Validate behaviour and document changes
  - [ ] 4.1 Create component tests covering click and keyboard sorting, persisted session behaviour, and regression checks for filters.
  - [ ] 4.2 Run linting and test suites for the data dashboard package, addressing any issues uncovered.
  - [ ] 4.3 Update release notes or dashboard documentation with usage guidance and QA checklist outcomes.
