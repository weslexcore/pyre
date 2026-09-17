import type { HoursWindow, LocationContent } from './types';

const location: LocationContent = {
  name: 'PYRE',
  neighborhood: '@ Living Water',
  address: '1000 Westover Hills Blvd, Richmond, VA 23225',
  phone: '(804) 361-7654',
  email: 'hi@pyresauna.com',
  instagram: '@pyre_sauna',
  instagramUrl: 'https://instagram.com/pyre_sauna',
  mapsUrl:
    'https://www.google.com/maps/search/?api=1&query=Pyre+Sauna',
  tagline: 'SELF-CARE TOGETHER',
  // Times are 24h wall clock so the LocalBusiness JSON-LD in layouts/main.astro
  // can read the same source the displayed hours do; formatHour() makes the
  // marketing label ("16:00" -> "4PM").
  hours: [
    { day: 'WED', dayOfWeek: 'Wednesday', windows: [{ open: '16:00', close: '20:00' }] },
    {
      day: 'THURS',
      dayOfWeek: 'Thursday',
      windows: [
        { open: '07:00', close: '10:00' },
        { open: '16:00', close: '20:00' },
      ],
    },
    { day: 'FRI', dayOfWeek: 'Friday', windows: [{ open: '16:00', close: '21:00' }] },
    { day: 'SAT', dayOfWeek: 'Saturday', windows: [{ open: '09:00', close: '20:00' }] },
    { day: 'SUN', dayOfWeek: 'Sunday', windows: [{ open: '13:00', close: '20:00' }] },
  ],
};

/** "16:00" -> "4PM", "07:30" -> "7:30AM". */
export function formatHour(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
}

/** "4PM - 8PM", with whatever separator the caller wants between the two. */
export function formatWindow(window: HoursWindow, separator = ' - '): string {
  return `${formatHour(window.open)}${separator}${formatHour(window.close)}`;
}

export default location;
