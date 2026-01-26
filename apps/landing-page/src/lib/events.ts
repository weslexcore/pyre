import type { EventsContent } from './types';

// Static fallback events content for SSG/SEO and loading states
// Events are fetched at runtime via /api/events endpoint
const fallbackEvents: EventsContent = {
  title: 'Upcoming Events',
  subtitle: 'Join our community gatherings',
  items: [],
  viewAllCta: {
    label: 'View All Events',
    href: '/events',
    ariaLabel: 'View all upcoming events',
  },
};

export default fallbackEvents;

// Named export for backward compatibility
export { fallbackEvents };
