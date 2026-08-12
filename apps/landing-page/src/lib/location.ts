import type { LocationContent } from './types';

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
  hours: [
    { day: 'WED', open: '4PM', close: '8PM' },
    { day: 'THURS', open: '4PM', close: '8PM' },
    { day: 'FRI', open: '4PM', close: '9PM' },
    { day: 'SAT', open: '10AM', close: '4PM' },
    { day: 'SUN', open: '1PM', close: '4PM' },
  ],
};

export default location;
