// Events page configuration

export const EVENTS_CONFIG = {
  quickFilters: [
    { id: 'week', label: 'This Week' },
    { id: 'month', label: 'This Month' },
    { id: '30days', label: 'Next 30 Days' },
    { id: 'all', label: 'All Upcoming' },
  ],
  defaultFilter: 'all',
} as const;

export type QuickFilterId = (typeof EVENTS_CONFIG.quickFilters)[number]['id'];
