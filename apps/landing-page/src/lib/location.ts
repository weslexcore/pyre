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
    { day: 'SUN', open: '8AM', close: '10PM' },
    { day: 'MON', open: '6AM', close: '10PM' },
    { day: 'TUE', open: '6AM', close: '10PM' },
    { day: 'WED', open: '6AM', close: '10PM' },
    { day: 'THU', open: '6AM', close: '10PM' },
    { day: 'FRI', open: '6AM', close: '10PM' },
    { day: 'SAT', open: '8AM', close: '10PM' },
  ],
};

export default location;
