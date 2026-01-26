import type { LocationContent } from './types';

const location: LocationContent = {
  name: 'PYRE',
  neighborhood: '@ Living Water',
  address: '1000 Westover Hills Blvd, Richmond, VA 23225',
  phone: '(804) 555-1234',
  email: 'hi@pyresauna.com',
  instagram: '@pyre_sauna',
  instagramUrl: 'https://instagram.com/pyre_sauna',
  tagline: 'SELF CARE TOGETHER',
  hours: [
    { day: 'THU', open: '6PM', close: '8PM' },
    { day: 'FRI', open: '6PM', close: '9PM' },
    { day: 'SAT', open: '10AM', close: '4PM' },
    { day: 'SUN', open: '10AM', close: '4PM' },
    { day: 'MON', open: '6PM', close: '8PM' },
  ],
};

export default location;
