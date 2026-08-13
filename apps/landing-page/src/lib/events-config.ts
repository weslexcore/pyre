// Events page configuration

// Note: the events page shows every upcoming session Momence publishes — date
// curation (how far out the calendar extends) happens on the Momence side.

// Sentinel filter id + label for the default chip that shows every type.
export const ALL_TYPES_FILTER = 'all';
export const ALL_TYPES_LABEL = 'All';

// Momence tag that marks a session as a one-off special event.
export const SPECIAL_EVENT_TAG = 'Special Event';

// The only Momence tags surfaced as session-type filter chips, in display order.
// A chip is shown only if at least one upcoming event carries the tag. Matching
// against events is case-insensitive; these canonical strings are used for the
// chip label and the ?type= URL value.
export const CATEGORY_TAGS = [
  'Guided',
  'Social',
  SPECIAL_EVENT_TAG,
  'Yoga',
  'Breathwork',
  'Qigong',
  'Open Hours',
];
