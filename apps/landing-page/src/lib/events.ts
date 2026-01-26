import type { EventsContent } from './types';
import { getEventsContentFromMomence } from './momence';

// Fallback events used when Momence API is unavailable
const fallbackEvents: EventsContent = {
  title: 'Upcoming Events',
  subtitle: 'Join our community gatherings',
  items: [
    {
      id: 'new-moon-ceremony',
      title: 'New Moon Ceremony',
      description:
        'A guided meditation and sauna ritual to set intentions for the lunar cycle.',
      date: 'February 28, 2025',
      time: '7:00 PM - 9:00 PM',
      location: 'Main Sauna Room',
      cta: {
        label: 'Reserve Spot',
        href: '#',
        ariaLabel: 'Reserve spot for New Moon Ceremony',
      },
    },
    {
      id: 'breathwork-cold',
      title: 'Breathwork & Cold Exposure',
      description:
        'Learn Wim Hof-inspired breathing techniques followed by guided cold plunge practice.',
      date: 'March 5, 2025',
      time: '6:30 PM - 8:30 PM',
      location: 'Cold Plunge Studio',
      cta: {
        label: 'Reserve Spot',
        href: '#',
        ariaLabel: 'Reserve spot for Breathwork & Cold Exposure',
      },
    },
    {
      id: 'silent-saturday',
      title: 'Silent Saturday',
      description:
        'A device-free, conversation-free morning session for deep relaxation and introspection.',
      date: 'March 8, 2025',
      time: '7:00 AM - 10:00 AM',
      location: 'All Facilities',
      cta: {
        label: 'Reserve Spot',
        href: '#',
        ariaLabel: 'Reserve spot for Silent Saturday',
      },
    },
    {
      id: 'community-social',
      title: 'Community Social',
      description:
        'Meet fellow members, enjoy refreshments, and experience our facilities together.',
      date: 'March 15, 2025',
      time: '5:00 PM - 8:00 PM',
      location: 'Lounge & All Facilities',
      cta: {
        label: 'Reserve Spot',
        href: '#',
        ariaLabel: 'Reserve spot for Community Social',
      },
    },
  ],
  viewAllCta: {
    label: 'View All Events',
    href: '#',
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
