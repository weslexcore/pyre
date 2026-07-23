// Events page configuration

// Hard limit for the events page: only show sessions within the next 2 weeks.
export const WINDOW_DAYS = 14;

// Sentinel filter id + label for the default chip that shows every type in the window.
export const ALL_TYPES_FILTER = 'all';
export const ALL_TYPES_LABEL = 'All';

// Momence tag that marks a session as a one-off special event. Special events
// are shown regardless of how far out they are (they bypass the 2-week window).
export const SPECIAL_EVENT_TAG = 'Special Event';

// The only Momence tags surfaced as session-type filter chips, in display order.
// A chip is shown only if at least one upcoming event in the window carries the
// tag. Matching against events is case-insensitive; these canonical strings are
// used for the chip label and the ?type= URL value.
export const CATEGORY_TAGS = ['Guided', 'Social', SPECIAL_EVENT_TAG, 'Yoga', 'Breathwork', 'Open Hours'];

// Whether an event carries the Special Event tag (case-insensitive). Pure helper
// shared by the client grid and the /api/events route so special events bypass
// both window filters consistently.
export function isSpecialEvent(event: { tags?: string[] }): boolean {
  if (!Array.isArray(event.tags)) return false;
  const lower = SPECIAL_EVENT_TAG.toLowerCase();
  return event.tags.some((t) => t.trim().toLowerCase() === lower);
}
