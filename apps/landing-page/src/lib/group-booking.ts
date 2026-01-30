import type { GroupBookingContent } from './types';

const groupBooking: GroupBookingContent = {
  title: 'Private Group Experiences',
  subtitle: 'Celebrate together in the heat',
  description: [
    'Private bookings include exclusive access to our sauna and cold plunge facilities, with options for guided sessions and customized experiences tailored to your group.',
  ],
  capacity: {
    max: 25,
    label: 'Up to 25 guests',
  },
  occasions: [
    { label: 'Birthdays' },
    { label: 'Bachelor / Bachelorette' },
    { label: 'Corporate Events' },
    { label: 'Special Celebrations' },
  ],
  // features: [
  //   'Exclusive private access',
  //   'Customizable session duration',
  //   'Guided or self-directed options',
  //   'Catering coordination available',
  // ],
  cta: {
    label: 'HIT US UP',
    href: 'mailto:groups@pyresauna.com?subject=Group Booking Inquiry',
    ariaLabel: 'Send an email to inquire about booking a private group session',
  },
  // secondaryCta: {
  //   label: 'Call Us',
  //   href: 'tel:+18045551234',
  //   ariaLabel: 'Call Pyre to discuss group booking options',
  // },
};

export default groupBooking;
