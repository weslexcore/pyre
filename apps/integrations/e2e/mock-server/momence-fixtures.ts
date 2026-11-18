// Momence v1 Events feed for the mock server: two upcoming sessions, dated
// relative to now so they never go stale.

import { daysFromNow } from '@pyre/e2e-utils/server';

export function momenceEvents() {
  return [
    {
      id: 900001,
      title: 'Social Sauna',
      dateTime: daysFromNow(1, 22),
      duration: 90,
      tags: [{ name: 'social' }],
      location: 'Pyre Sauna',
    },
    {
      id: 900002,
      title: 'Guided Session',
      dateTime: daysFromNow(2, 23),
      duration: 75,
      tags: [{ name: 'guided' }],
      location: 'Pyre Sauna',
    },
  ];
}
