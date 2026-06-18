// Events page configuration

// Hard limit for the events page: only show sessions within the next 2 weeks.
export const WINDOW_DAYS = 14;

// Sentinel filter id + label for the default chip that shows every type in the window.
export const ALL_TYPES_FILTER = 'all';
export const ALL_TYPES_LABEL = 'All';

// The only Momence tags surfaced as session-type filter chips, in display order.
// A chip is shown only if at least one upcoming event in the window carries the
// tag. Matching against events is case-insensitive; these canonical strings are
// used for the chip label and the ?type= URL value.
export const CATEGORY_TAGS = ['Guided', 'Social', 'Special Event', 'Open Hours'];
