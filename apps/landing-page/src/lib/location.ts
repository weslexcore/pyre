import type { LocationContent } from './types';

const location: LocationContent = {
  name: 'PYRE',
  neighborhood: '@ Living Water',
  address: '1000 Westover Hills Blvd, Richmond, VA 23225',
  phone: '',
  email: 'hi@pyresauna.com',
  instagram: '@pyre_sauna',
  instagramUrl: 'https://instagram.com/pyre_sauna',
  mapsUrl:
    'https://www.google.com/maps/search/?api=1&query=1000+Westover+Hills+Blvd,+Richmond,+VA+23225',
  tagline: 'SELF-CARE TOGETHER',
  hours: [
    // { day: 'Coming Soon', open: '', close: '' },
    { day: 'MON', open: '6PM', close: '8PM' },
    { day: 'THURS', open: '6PM', close: '8PM' },
    { day: 'FRI', open: '6PM', close: '9PM' },
    { day: 'SAT / SUN', open: '10AM', close: '4PM' },
  ],
};

export default location;
