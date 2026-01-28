// EventCardActions component
// React island for event card booking actions
// Used within the Astro EventCard component

import { BookButton } from './BookButton';

interface EventCardActionsProps {
  eventId: string;
  eventTitle: string;
  momenceLink: string;
  ctaLabel: string;
  isFull: boolean;
}

export function EventCardActions({
  eventId,
  eventTitle,
  momenceLink,
  ctaLabel: _ctaLabel, // Reserved for future use
  isFull,
}: EventCardActionsProps) {
  return (
    <BookButton
      eventId={eventId}
      eventTitle={eventTitle}
      momenceLink={momenceLink}
      isFull={isFull}
      className="w-full"
    />
  );
}
