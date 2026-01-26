import type { EventsContent } from './types';
import { getEventsContentFromMomence } from './momence';

// Fallback events used when Momence API is unavailable
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

/**
 * Async function to get events content
 * Fetches from Momence API at build time, falls back to static events on error
 */
export async function getEventsContent(): Promise<EventsContent> {
  return getEventsContentFromMomence(fallbackEvents);
}

// Default export for backward compatibility
export default fallbackEvents;
