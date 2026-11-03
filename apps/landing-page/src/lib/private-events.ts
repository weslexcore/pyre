import groupBooking from './group-booking';
import type { PrivateEventNoticeContent } from './types';

// Shown in place of the description when someone opens a session labelled
// Private on the schedule. A private session belongs to whoever booked it, so
// rather than its own details the visitor gets an invitation to request one.
const privateEventNotice: PrivateEventNoticeContent = {
  description: [
    'This session is reserved for a private group.',
    'Want the bathhouse to yourself? We host birthdays, team outings, bachelor and bachelorette parties, and other celebrations for up to 30 guests. Send us a private rental request and we will help you plan it.',
  ],
  cta: {
    label: 'Request a Private Rental',
    href: groupBooking.cta.href,
    ariaLabel: 'Open the private rental request form',
  },
};

export default privateEventNotice;
