# PRD: Add "View All" Option to Data Table

- **Feature Number:** 0046
- **Status:** To Do

## 1. Introduction/Overview

This document outlines the requirements for adding a "View All" option to the pagination controls of the main data table in the data-dashboard project. Currently, users can only view data in paginated chunks (e.g., 10, 25, or 50 rows at a time). This limitation makes it difficult to get a holistic view of the entire dataset or to perform searches across all records simultaneously. This feature will introduce an option to display all table rows at once, improving data accessibility and analysis capabilities.

## 2. Goals

-   Allow users to view the entire dataset in the table with a single action.
-   Enable global search and filtering across all records without pagination.
-   Provide a complete, unpaginated overview of the data.

## 3. User Stories

-   As an administrator, I want to select a "View All" option for the table so that I can see every record at once and get a complete overview of the data.
-   As a data analyst, I want to load all entries in the table simultaneously so that I can use the browser's search functionality (Ctrl/Cmd+F) or the table's own filters to find specific information across the entire dataset quickly.

## 4. Functional Requirements

1.  The "Rows per page" dropdown in the table's pagination component must include a new option labeled "All".
2.  When a user selects the "All" option, the table must re-render to display all available rows of data.
3.  When "All" is selected, the pagination controls (e.g., "next," "previous," page number indicators) should be hidden or disabled, as they are no longer applicable.
4.  All existing table functionalities, including column sorting and data filtering, must remain fully functional when "View All" mode is active.
5.  The table should revert to its default paginated view if the user selects a different "Rows per page" option (e.g., 10, 25, 50).

## 5. Non-Goals (Out of Scope)

-   No performance warnings or confirmation dialogs will be implemented. Users are expected to understand that loading very large datasets may result in performance degradation.
-   This feature does not include any new data export functionality (e.g., "Export to CSV"). It only affects the display of data within the web interface.

## 6. Design Considerations

-   The "All" option should be added to the existing "Rows per page" dropdown menu, consistent with the current UI design.

## 7. Technical Considerations

-   The front-end application will need to make a single API request to fetch the entire dataset when the "All" option is selected.
-   The solution should handle potentially large amounts of data gracefully to avoid browser freezing, though no hard limits will be enforced.

## 8. Success Metrics

-   Successful implementation will be confirmed when a user can select the "All" option and see all table rows displayed correctly.
-   All existing sorting and filtering functions operate correctly on the full dataset.

## 9. Open Questions

-   None at this time.
