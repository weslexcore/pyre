## Introduction / Overview

Operators monitoring session performance in the data dashboard need to compare multiple metrics simultaneously (e.g., booking volume followed by fill rate) without re-sorting repeatedly. Today the table only supports single-column sorting, forcing repetitive manual resorting and making it hard to preserve nuanced ordering when exporting results. Multi-column sorting will let operators define a prioritized sort stack that persists for the session and applies across filtering and export workflows.

## Goals

- Enable operators to compose multi-column sort sequences on the Session Explorer table within two interactions.
- Preserve an operator’s preferred multi-column sort within the browser session so it survives navigation inside the dashboard.
- Ensure downstream outputs (visible table, CSV export) respect the configured sort order.
- Provide clear visual cues of column priority to reduce sort mistakes.

## User Stories

- As an operator reviewing upcoming sessions, I can choose multiple columns (e.g., Booked → Fill Rate → Time) so I immediately spot high-priority classes without manually reordering the table after each filter change.
- As an operator exporting filtered results, I get the CSV in the same multi-column order shown on screen so I can share reports without post-processing.
- As an operator returning to the Sessions tab within the same browser session, my previously configured multi-column sort re-applies automatically so I can pick up where I left off.

## Functional Requirements

1. The Session Explorer table must offer a “Sort columns” control that opens a multi-select panel listing all sortable columns with individual on/off toggles.
2. Selecting a column adds it to an ordered sort stack displayed within the panel, showing a numeric badge for priority (1 = highest) and the current direction (Asc/Desc).
3. Each selected column must include a direction toggle (single click/tap cycles Asc → Desc → Asc).
4. Removing a column from the stack must automatically collapse the remaining priorities upward without gaps.
5. The active sort order must display on the table header, including badges or labels that match the priority numbers from the panel.
6. The multi-column sort must apply to the in-memory dataset after filters/search, before pagination, matching the defined priority sequence.
7. The sort configuration must persist in `sessionStorage` using the existing signature approach so that reloads or route changes within the same tab restore it.
8. If the underlying dataset signature changes, the stored sort must be cleared automatically and the default (Date desc) applied.
9. Table exports (existing CSV or future exports) must use the same sorted dataset to ensure consistency with the on-screen order.
10. Keyboard users must be able to navigate the sort panel, toggle directions, and reorder columns via accessible controls (e.g., up/down buttons or move handles compatible with keyboard interaction).

## Non-Goals

- Persisting sort state beyond the browser session (no localStorage/back-end storage).
- Introducing server-assisted sorting or pagination; everything remains client-side for this iteration.
- Changing the default single-column sort behavior (Date desc) when no custom stack is configured.

## Design Considerations (Optional)

- Reuse existing ShadCN modal/sheet or popover patterns for the “Sort columns” UI to keep styling consistent.
- Priority badges should be high-contrast and align with the table header typography; consider leveraging `Badge` component variants.
- Provide inline helper text in the panel explaining that order determines precedence (1 takes priority).

## Technical Considerations (Optional)

- Extend the current `SortDefinition` map to support arrays of column keys and a deterministic compare function that iterates priority order.
- Session signature should continue to use dataset size/timestamp range to invalidate stale stored stacks.
- Exports should reuse the same sorted array before generating CSV to avoid duplication.
- Guard sessionStorage access for SSR and private mode errors (follow pattern from `lib/session-sort.ts`).

## Success Metrics

- 90% of operator usability test participants can configure a three-column sort in under 20 seconds.
- Reduction in internal support requests related to “sorting multiple columns” by 80% within a month of release.
- CSV exports manually spot-checked during QA match the on-screen order for at least five multi-column combinations.

## Open Questions

- Should the multi-column sort panel allow drag-and-drop reordering in addition to keyboard reorder buttons?
- Do we need quick presets (e.g., “Attendance efficiency” = Booked desc → Fill Rate desc) or will manual stacks suffice?
- Are there columns that should be hidden by default in the sort panel for clarity (e.g., internal IDs)?
