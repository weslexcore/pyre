// Fixture data for the mock Momence v1 API. Event dates are computed per
// request, relative to now, so the calendar is always upcoming.
//
// The set is chosen to exercise the events pipeline: three category tags (so
// the type filter renders), one full session (waitlist CTA), and three
// sessions the public pipeline must drop (volunteer, cancelled, past).

import { daysFromNow } from '@pyre/e2e-utils/server';
import type { MomenceEvent, MomenceTeacher } from '../../src/lib/momence-types';
import type { MomenceProduct } from '../../src/lib/types';

export const TEACHER: MomenceTeacher = {
  id: 7001,
  firstName: 'Avery',
  lastName: 'Fixture',
  bio: 'Breathwork guide and long-time sauna regular.',
  profileImage: null,
  isDeleted: false,
};

/** Ids and titles the specs assert on. */
export const FIXTURE_EVENTS = {
  guided: { id: 900001, title: 'E2E Guided Sauna' },
  yoga: { id: 900002, title: 'E2E Sauna Yoga' },
  social: { id: 900003, title: 'E2E Social Evening' },
  full: { id: 900004, title: 'E2E Breathwork Full House' },
  volunteer: { id: 900005, title: 'E2E Volunteer Shift' },
  cancelled: { id: 900006, title: 'E2E Cancelled Session' },
  past: { id: 900007, title: 'E2E Past Session' },
} as const;

function event(
  overrides: Partial<MomenceEvent> & Pick<MomenceEvent, 'id' | 'title' | 'dateTime'>
): MomenceEvent {
  return {
    description: `${overrides.title} — a fixture session for the E2E suite.`,
    type: 'class',
    link: `https://momence.com/s/${overrides.id}`,
    duration: 60,
    fixedPrice: 30,
    location: 'Pyre Sauna',
    capacity: 12,
    spotsRemaining: 8,
    ticketsSold: 4,
    isCancelled: false,
    isDeleted: false,
    allowWaitlist: true,
    published: true,
    teacher: `${TEACHER.firstName} ${TEACHER.lastName}`,
    originalTeacher: `${TEACHER.firstName} ${TEACHER.lastName}`,
    teacherId: TEACHER.id,
    originalTeacherId: TEACHER.id,
    additionalTeachers: [],
    image1: null,
    image2: null,
    tags: [],
    hostId: 1,
    online: false,
    streamLink: null,
    streamPassword: null,
    ...overrides,
  };
}

export function momenceEvents(now = new Date()): MomenceEvent[] {
  const e = FIXTURE_EVENTS;
  return [
    event({ ...e.guided, dateTime: daysFromNow(2, 22, 0, now), duration: 120, tags: ['Guided'] }),
    event({ ...e.yoga, dateTime: daysFromNow(3, 15, 0, now), tags: ['Yoga'] }),
    // Social is a pooled tag; a standalone full-length session still renders.
    event({ ...e.social, dateTime: daysFromNow(4, 23, 0, now), duration: 180, tags: ['Social'] }),
    event({
      ...e.full,
      dateTime: daysFromNow(5, 16, 0, now),
      spotsRemaining: 0,
      ticketsSold: 12,
      tags: ['Breathwork'],
    }),
    event({ ...e.volunteer, dateTime: daysFromNow(2, 14, 0, now), tags: ['Volunteer'] }),
    event({ ...e.cancelled, dateTime: daysFromNow(3, 20, 0, now), isCancelled: true }),
    event({ ...e.past, dateTime: daysFromNow(-3, 18, 0, now), tags: ['Guided'] }),
  ];
}

export const momenceTeachers: MomenceTeacher[] = [TEACHER];

/** Momence product ids match the static catalogue in src/lib/shop.ts. */
export const FIXTURE_PRODUCTS = {
  tote: { id: 439299, price: 42 },
  shirt: { id: 439332, price: 38 },
  sticker: { id: 439371, price: 5 },
} as const;

export const momenceProducts: MomenceProduct[] = [
  {
    id: FIXTURE_PRODUCTS.tote.id,
    name: 'The Bathhouse Tote',
    description: null,
    link: 'https://momence.com/g/439299',
    imageLink: '',
    price: FIXTURE_PRODUCTS.tote.price,
    leftInStock: 10,
    isDeleted: false,
    availableForShipping: false,
    variants: [],
  },
  {
    id: FIXTURE_PRODUCTS.shirt.id,
    name: 'Duality Shirt',
    description: null,
    link: 'https://momence.com/g/439332',
    imageLink: '',
    price: FIXTURE_PRODUCTS.shirt.price,
    leftInStock: 6,
    isDeleted: false,
    availableForShipping: false,
    variants: [
      { id: 1, name: 'L', price: 38, link: '', leftInStock: 0, isDeleted: false },
      { id: 2, name: 'S', price: 38, link: '', leftInStock: 3, isDeleted: false },
      { id: 3, name: 'M', price: 38, link: '', leftInStock: 3, isDeleted: false },
    ],
  },
  {
    id: FIXTURE_PRODUCTS.sticker.id,
    name: 'OG Sticker',
    description: null,
    link: 'https://momence.com/g/439371',
    imageLink: '',
    price: FIXTURE_PRODUCTS.sticker.price,
    leftInStock: 0,
    isDeleted: false,
    availableForShipping: false,
    variants: [],
  },
];
