import type { EventsContent } from './types';

// Static fallback events content for SSG/SEO and loading states
// Events are fetched at runtime via /api/events endpoint
const fallbackEvents: EventsContent = {
  title: 'Upcoming Sessions',
  subtitle: 'Join our community gatherings',
  items: [],
  viewAllCta: {
    label: 'View Sessions',
    href: '/events',
    ariaLabel: 'View all upcoming sessions',
  },
  emptyState: {
    message: 'More events coming soon',
    cta: {
      label: 'Get Updates',
      href: '#signup',
      ariaLabel: 'Sign up for email updates about upcoming events',
    },
  },
};

export default fallbackEvents;

// Named export for backward compatibility
export { fallbackEvents };

// Shown when the events fetch fails and no cached data is available —
// distinct from the genuine "no upcoming sessions" empty state.
export const eventsLoadError = {
  message: "We couldn't load upcoming sessions.",
  hint: 'Please try again in a moment.',
  retryLabel: 'Try Again',
  retryAriaLabel: 'Retry loading upcoming sessions',
};
