## Relevant Files

- `apps/data-dashboard/components/dashboard/data-table.tsx` (Existing) - This is the main component for the data table and will be modified to add the "View All" functionality.
- `apps/data-dashboard/components/dashboard/data-table.test.tsx` (Existing) - The test file for the data table component. It will be updated to include tests for the new "View All" feature.

### Notes

- Unit tests should typically be placed alongside the code files they are testing (e.g., `MyComponent.tsx` and `MyComponent.test.tsx` in the same directory).
- Use `npx jest [optional/path/to/test/file]` to run tests. Running without a path executes all tests found by the Jest configuration.

## Tasks

- [x] 1.0 Update the `DataTable` component to support a "View All" option.
  - [x] 1.1 Add a value representing "All" to the `PAGE_SIZE_OPTIONS` array. A large number like `Number.MAX_SAFE_INTEGER` can be used to represent all rows.
  - [x] 1.2 Update the "Rows per page" `Select` component to include an "All" option in the dropdown.
- [x] 2.0 Adjust the pagination logic to handle the "View All" state.
  - [x] 2.1 Modify the `visibleRows` calculation to return all `sortedData` when the "All" page size is selected.
  - [x] 2.2 Update the `totalPages` calculation to be `1` when "All" is selected.
- [x] 3.0 Conditionally render the pagination controls.
  - [x] 3.1 Wrap the pagination controls (page number display and next/previous buttons) in a condition to hide them when the "All" view is active.
- [x] 4.0 Update the test file for the data table component.
  - [x] 4.1 Add a new test case to `data-table.test.tsx` to verify the "View All" functionality.
  - [x] 4.2 In the test, simulate selecting the "All" option and assert that the number of rows displayed equals the total number of records.
  - [x] 4.3 Assert that the pagination controls are not visible when "All" is selected.
